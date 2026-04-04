// Last modified: 2026-04-03 by Nolan DeSchryver
// 2026-04-03: Added getPromptHubCallbackUrl() and POST /response-callback route
//             by Nolan DeSchryver and Claude (claude-sonnet-4-6)
// 2026-04-03: resolve-insert now forwards callbackToken to frontend

const express = require('express');
const axios = require('axios');
const { logger } = require('@librechat/data-schemas');
const { getMessage, getConvoTitle } = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

function getPromptHubResolveUrl() {
  const baseUrl = process.env.PROMPTHUB_API_URL;
  if (!baseUrl) {
    return null;
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  if (normalizedBase.endsWith('/api')) {
    return `${normalizedBase}/prompts/insert-tickets/resolve`;
  }

  return `${normalizedBase}/api/prompts/insert-tickets/resolve`;
}

function getPromptHubCallbackUrl() {
  const baseUrl = process.env.PROMPTHUB_API_URL;
  if (!baseUrl) {
    return null;
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  if (normalizedBase.endsWith('/api')) {
    return `${normalizedBase}/prompts/insert-tickets/callback`;
  }

  return `${normalizedBase}/api/prompts/insert-tickets/callback`;
}

function getPromptHubExportUrl() {
  const baseUrl = process.env.PROMPTHUB_API_URL;
  if (!baseUrl) {
    return null;
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  if (normalizedBase.endsWith('/api')) {
    return `${normalizedBase}/prompts/from-librechat-export`;
  }

  return `${normalizedBase}/api/prompts/from-librechat-export`;
}

function extractMessageText(message) {
  if (!message) {
    return '';
  }

  if (typeof message.text === 'string' && message.text.trim().length > 0) {
    return message.text;
  }

  if (typeof message.content === 'string' && message.content.trim().length > 0) {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('')
      .trim();
  }

  return '';
}

function buildPromptTitle(promptText) {
  if (!promptText || typeof promptText !== 'string') {
    return 'Imported from LibreChat';
  }

  const normalized = promptText.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Imported from LibreChat';
  }

  return normalized.slice(0, 120);
}

router.post('/resolve-insert', requireJwtAuth, async (req, res) => {
  const { ticketId } = req.body ?? {};
  if (!ticketId || typeof ticketId !== 'string') {
    return res.status(400).json({ message: 'ticketId is required' });
  }

  const resolverSecret = process.env.PROMPTHUB_INSERT_RESOLVE_SECRET;
  if (!resolverSecret) {
    return res.status(500).json({ message: 'PromptHub resolver secret is not configured' });
  }

  const resolveUrl = getPromptHubResolveUrl();
  if (!resolveUrl) {
    return res.status(500).json({ message: 'PROMPTHUB_API_URL is not configured' });
  }

  try {
    const response = await axios.post(
      resolveUrl,
      {
        ticket_id: ticketId,
        librechat_user_id: req.user?.id,
      },
      {
        timeout: 10000,
        headers: {
          'x-prompthub-resolve-secret': resolverSecret,
          'Content-Type': 'application/json',
        },
      },
    );

    return res.status(200).json({
      content: response.data?.content ?? '',
      promptId: response.data?.prompt_id,
      versionId: response.data?.version_id,
      callbackToken: response.data?.callback_token ?? null,
    });
  } catch (error) {
    const status = error?.response?.status;
    const detail = error?.response?.data?.detail;

    logger.error('[prompthub.resolve-insert] Failed to resolve insert ticket', {
      status,
      detail,
      message: error?.message,
    });

    if (status === 404 || status === 410) {
      return res.status(status).json({ message: detail || 'Insert ticket is invalid or expired' });
    }

    if (status === 401 || status === 403) {
      return res.status(502).json({ message: 'PromptHub rejected ticket resolution request' });
    }

    return res.status(502).json({ message: 'Unable to resolve insert ticket from PromptHub' });
  }
});

router.post('/export-message', requireJwtAuth, async (req, res) => {
  const { messageId } = req.body ?? {};
  if (!messageId || typeof messageId !== 'string') {
    return res.status(400).json({ message: 'messageId is required' });
  }

  const exportSecret = process.env.PROMPTHUB_INSERT_RESOLVE_SECRET;
  if (!exportSecret) {
    return res.status(500).json({ message: 'PromptHub export secret is not configured' });
  }

  const exportUrl = getPromptHubExportUrl();
  if (!exportUrl) {
    return res.status(500).json({ message: 'PROMPTHUB_API_URL is not configured' });
  }

  try {
    const assistantMessage = await getMessage({ user: req.user.id, messageId });
    if (!assistantMessage) {
      return res.status(404).json({ message: 'Message not found' });
    }

    if (assistantMessage.isCreatedByUser === true) {
      return res.status(400).json({ message: 'Only assistant messages can be exported' });
    }

    if (!assistantMessage.parentMessageId) {
      return res.status(400).json({ message: 'Unable to find paired user prompt for this message' });
    }

    const promptMessage = await getMessage({
      user: req.user.id,
      messageId: assistantMessage.parentMessageId,
    });

    if (!promptMessage || promptMessage.isCreatedByUser !== true) {
      return res.status(400).json({ message: 'Unable to resolve paired user prompt' });
    }

    const promptText = extractMessageText(promptMessage);
    const responseText = extractMessageText(assistantMessage);
    const convoTitle = await getConvoTitle(req.user.id, assistantMessage.conversationId);
    const title = typeof convoTitle === 'string' && convoTitle.trim() ? convoTitle : buildPromptTitle(promptText);

    if (!promptText || !responseText) {
      return res.status(400).json({ message: 'Prompt or response text is empty' });
    }

    const response = await axios.post(
      exportUrl,
      {
        prompt_text: promptText,
        response_text: responseText,
        title,
        source_user_id: req.user?.id,
        source_user_email: req.user?.email,
        source_user_name: req.user?.name,
        source_user_username: req.user?.username,
      },
      {
        timeout: 15000,
        headers: {
          'x-prompthub-resolve-secret': exportSecret,
          'Content-Type': 'application/json',
        },
      },
    );

    return res.status(200).json({
      success: response.data?.success ?? true,
      promptId: response.data?.prompt_id,
      versionId: response.data?.version_id,
      responseId: response.data?.response_id,
      prompthubUrl: response.data?.prompthub_url,
    });
  } catch (error) {
    const status = error?.response?.status;
    const detail = error?.response?.data?.detail || error?.response?.data?.message;

    logger.error('[prompthub.export-message] Failed to export message to PromptHub', {
      status,
      detail,
      message: error?.message,
      messageId,
      userId: req.user?.id,
    });

    if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) {
      return res.status(status).json({ message: detail || 'PromptHub rejected export request' });
    }

    if (status && detail) {
      return res.status(502).json({ message: detail });
    }

    if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND' || error?.code === 'ETIMEDOUT') {
      return res.status(502).json({
        message: 'Unable to reach PromptHub export endpoint. Check PROMPTHUB_API_URL and service availability.',
      });
    }

    return res.status(502).json({ message: 'Unable to export message to PromptHub' });
  }
});

router.post('/response-callback', requireJwtAuth, async (req, res) => {
  const { callbackToken, messageId } = req.body ?? {};

  if (!callbackToken || typeof callbackToken !== 'string') {
    return res.status(400).json({ message: 'callbackToken is required' });
  }
  if (!messageId || typeof messageId !== 'string') {
    return res.status(400).json({ message: 'messageId is required' });
  }

  const resolverSecret = process.env.PROMPTHUB_INSERT_RESOLVE_SECRET;
  if (!resolverSecret) {
    return res.status(500).json({ message: 'PromptHub resolver secret is not configured' });
  }

  const callbackUrl = getPromptHubCallbackUrl();
  if (!callbackUrl) {
    return res.status(500).json({ message: 'PROMPTHUB_API_URL is not configured' });
  }

  try {
    const assistantMessage = await getMessage({ user: req.user.id, messageId });
    if (!assistantMessage) {
      return res.status(404).json({ message: 'Message not found' });
    }

    if (assistantMessage.isCreatedByUser === true) {
      return res.status(400).json({ message: 'Only assistant messages can be saved as responses' });
    }

    const responseText = extractMessageText(assistantMessage);
    if (!responseText) {
      return res.status(400).json({ message: 'Response text is empty' });
    }

    const response = await axios.post(
      callbackUrl,
      {
        callback_token: callbackToken,
        response_text: responseText,
      },
      {
        timeout: 10000,
        headers: {
          'x-prompthub-resolve-secret': resolverSecret,
          'Content-Type': 'application/json',
        },
      },
    );

    return res.status(200).json({
      success: response.data?.success ?? true,
      responseId: response.data?.response_id,
      versionId: response.data?.version_id,
      promptId: response.data?.prompt_id,
    });
  } catch (error) {
    const status = error?.response?.status;
    const detail = error?.response?.data?.detail;

    logger.error('[prompthub.response-callback] Failed to save response callback', {
      status,
      detail,
      message: error?.message,
      messageId,
      userId: req.user?.id,
    });

    if (status === 400 || status === 404) {
      return res.status(status).json({ message: detail || 'PromptHub rejected callback' });
    }

    return res.status(502).json({ message: 'Unable to save response to PromptHub' });
  }
});

module.exports = router;
