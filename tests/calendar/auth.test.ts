import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@project.iam.gserviceaccount.com',
    GOOGLE_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----',
    LOG_LEVEL: 'error',
  }),
}));

const { mockCalendar, mockJWT } = vi.hoisted(() => ({
  mockCalendar: vi.fn().mockReturnValue({ events: {} }),
  mockJWT: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: { JWT: mockJWT },
    calendar: mockCalendar,
  },
}));

import { getCalendarClient } from '../../src/calendar/auth.js';

describe('getCalendarClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a calendar client', () => {
    const client = getCalendarClient();
    expect(client).toBeDefined();
    expect(mockCalendar).toHaveBeenCalledWith({ version: 'v3', auth: expect.anything() });
  });

  it('caches on second call', () => {
    const first = getCalendarClient();
    const second = getCalendarClient();
    expect(first).toBe(second);
  });
});
