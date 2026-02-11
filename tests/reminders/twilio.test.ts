import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    TWILIO_ACCOUNT_SID: 'AC_test',
    TWILIO_AUTH_TOKEN: 'auth_test',
    TWILIO_FROM_NUMBER: '+15551234567',
    NOTIFICATION_PHONE_NUMBER: '+15559876543',
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

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('twilio', () => ({
  default: () => ({
    messages: { create: mockCreate },
  }),
}));

import { sendSMS } from '../../src/reminders/twilio.js';

describe('sendSMS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends successfully and returns SID', async () => {
    mockCreate.mockResolvedValue({ sid: 'SM_test_sid' });

    const sid = await sendSMS('Test message');

    expect(sid).toBe('SM_test_sid');
    expect(mockCreate).toHaveBeenCalledWith({
      body: 'Test message',
      from: '+15551234567',
      to: '+15559876543',
    });
  });

  it('throws on failure', async () => {
    mockCreate.mockRejectedValue(new Error('Twilio API error'));

    await expect(sendSMS('Test')).rejects.toThrow('Twilio API error');
  });
});
