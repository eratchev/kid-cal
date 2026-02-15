import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_CHAT_ID: '123456789',
    LOG_LEVEL: 'error',
  }),
}));
vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { sendNotification } from '../../src/reminders/telegram.js';

describe('sendNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends successfully and returns message ID', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { message_id: 42 } }),
    });

    const id = await sendNotification('Test message');

    expect(id).toBe('42');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-bot-token/sendMessage',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: '123456789',
          text: 'Test message',
        }),
      },
    );
  });

  it('throws on API error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad Request: chat not found'),
    });

    await expect(sendNotification('Test')).rejects.toThrow('Telegram API error 400');
  });

  it('throws on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(sendNotification('Test')).rejects.toThrow('Network error');
  });
});
