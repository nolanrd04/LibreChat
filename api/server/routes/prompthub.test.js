// Unit tests for LibreChat PromptHub routes
// Created: 2026-04-06 by Nolan DeSchryver and Claude (claude-sonnet-4-6)
// Last modified: 2026-04-06 by Nolan DeSchryver
// No running server or Docker required — axios and getMessage are mocked.

const express = require('express');
const request = require('supertest');

// ---------------------------------------------------------------------------
// Mocks (must be declared before requiring the route)
// ---------------------------------------------------------------------------

jest.mock('axios');
jest.mock('~/models', () => ({
  getMessage: jest.fn(),
  getConvoTitle: jest.fn(),
}));
jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    // Inject a fake authenticated user for every request
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test User', username: 'testuser' };
    next();
  },
}));

const axios = require('axios');
const { getMessage, getConvoTitle } = require('~/models');
const prompthubRouter = require('./prompthub');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/prompthub', prompthubRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Environment variables used by the routes
// ---------------------------------------------------------------------------

const RESOLVE_SECRET = 'test-resolve-secret';

beforeEach(() => {
  process.env.PROMPTHUB_API_URL = 'http://prompthub-backend:8000';
  process.env.PROMPTHUB_INSERT_RESOLVE_SECRET = RESOLVE_SECRET;
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/prompthub/resolve-insert
// ---------------------------------------------------------------------------

describe('POST /api/prompthub/resolve-insert', () => {
  test('returns callbackToken from PromptHub resolve response', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        content: 'Prompt text here',
        prompt_id: 10,
        version_id: 3,
        ticket_id: 'ticket-uuid',
        callback_token: 'cb-token-abc',
      },
    });

    const res = await request(buildApp())
      .post('/api/prompthub/resolve-insert')
      .send({ ticketId: 'ticket-uuid' });

    expect(res.status).toBe(200);
    expect(res.body.callbackToken).toBe('cb-token-abc');
    expect(res.body.content).toBe('Prompt text here');
  });

  test('returns callbackToken as null when PromptHub does not include it', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        content: 'Prompt text here',
        prompt_id: 10,
        version_id: 3,
        ticket_id: 'ticket-uuid',
        // no callback_token field
      },
    });

    const res = await request(buildApp())
      .post('/api/prompthub/resolve-insert')
      .send({ ticketId: 'ticket-uuid' });

    expect(res.status).toBe(200);
    expect(res.body.callbackToken).toBeNull();
  });

  test('returns 400 when ticketId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/prompthub/resolve-insert')
      .send({});

    expect(res.status).toBe(400);
  });

  test('forwards 404 from PromptHub when ticket is not found', async () => {
    axios.post.mockRejectedValueOnce({
      response: { status: 404, data: { detail: 'Insert ticket not found' } },
    });

    const res = await request(buildApp())
      .post('/api/prompthub/resolve-insert')
      .send({ ticketId: 'missing-ticket' });

    expect(res.status).toBe(404);
  });

  test('forwards 410 from PromptHub when ticket is already consumed', async () => {
    axios.post.mockRejectedValueOnce({
      response: { status: 410, data: { detail: 'Insert ticket already consumed' } },
    });

    const res = await request(buildApp())
      .post('/api/prompthub/resolve-insert')
      .send({ ticketId: 'used-ticket' });

    expect(res.status).toBe(410);
  });

  test('returns 500 when PROMPTHUB_API_URL is not configured', async () => {
    delete process.env.PROMPTHUB_API_URL;

    const res = await request(buildApp())
      .post('/api/prompthub/resolve-insert')
      .send({ ticketId: 'ticket-uuid' });

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/prompthub/response-callback
// ---------------------------------------------------------------------------

describe('POST /api/prompthub/response-callback', () => {
  const assistantMessage = {
    messageId: 'msg-456',
    isCreatedByUser: false,
    text: 'This is the AI response.',
    conversationId: 'conv-789',
  };

  test('saves response and returns success', async () => {
    getMessage.mockResolvedValueOnce(assistantMessage);
    axios.post.mockResolvedValueOnce({
      data: { success: true, response_id: 99, version_id: 3, prompt_id: 10 },
    });

    const res = await request(buildApp())
      .post('/api/prompthub/response-callback')
      .send({ callbackToken: 'cb-token-abc', messageId: 'msg-456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POSTs correct payload to PromptHub callback endpoint', async () => {
    getMessage.mockResolvedValueOnce(assistantMessage);
    axios.post.mockResolvedValueOnce({
      data: { success: true, response_id: 99, version_id: 3, prompt_id: 10 },
    });

    await request(buildApp())
      .post('/api/prompthub/response-callback')
      .send({ callbackToken: 'cb-token-abc', messageId: 'msg-456' });

    const [url, body, config] = axios.post.mock.calls[0];
    expect(url).toContain('/api/prompts/insert-tickets/callback');
    expect(body.callback_token).toBe('cb-token-abc');
    expect(body.response_text).toBe('This is the AI response.');
    expect(config.headers['x-prompthub-resolve-secret']).toBe(RESOLVE_SECRET);
  });

  test('returns 400 when callbackToken is missing', async () => {
    const res = await request(buildApp())
      .post('/api/prompthub/response-callback')
      .send({ messageId: 'msg-456' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when messageId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/prompthub/response-callback')
      .send({ callbackToken: 'cb-token-abc' });

    expect(res.status).toBe(400);
  });

  test('returns 404 when message is not found in database', async () => {
    getMessage.mockResolvedValueOnce(null);

    const res = await request(buildApp())
      .post('/api/prompthub/response-callback')
      .send({ callbackToken: 'cb-token-abc', messageId: 'msg-missing' });

    expect(res.status).toBe(404);
  });

  test('returns 400 when message is a user message, not assistant', async () => {
    getMessage.mockResolvedValueOnce({ ...assistantMessage, isCreatedByUser: true });

    const res = await request(buildApp())
      .post('/api/prompthub/response-callback')
      .send({ callbackToken: 'cb-token-abc', messageId: 'msg-456' });

    expect(res.status).toBe(400);
  });

  test('returns 500 when PROMPTHUB_API_URL is not configured', async () => {
    delete process.env.PROMPTHUB_API_URL;
    getMessage.mockResolvedValueOnce(assistantMessage);

    const res = await request(buildApp())
      .post('/api/prompthub/response-callback')
      .send({ callbackToken: 'cb-token-abc', messageId: 'msg-456' });

    expect(res.status).toBe(500);
  });

  test('forwards 404 from PromptHub when callback_token is not found', async () => {
    getMessage.mockResolvedValueOnce(assistantMessage);
    axios.post.mockRejectedValueOnce({
      response: { status: 404, data: { detail: 'Callback token not found' } },
    });

    const res = await request(buildApp())
      .post('/api/prompthub/response-callback')
      .send({ callbackToken: 'bad-token', messageId: 'msg-456' });

    expect(res.status).toBe(404);
  });
});