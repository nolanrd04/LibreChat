const express = require('express');
const axios = require('axios');
const { logger } = require('@librechat/data-schemas');
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

module.exports = router;
