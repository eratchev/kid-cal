import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test getConfig fresh each time, so we use dynamic import with resetModules
describe('getConfig', () => {
  const validEnv = {
    IMAP_USER: 'user@yahoo.com',
    IMAP_PASSWORD: 'password',
    SCHOOL_SENDER_DOMAINS: 'school.org,district.edu',
    ANTHROPIC_API_KEY: 'sk-test',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@project.iam.gserviceaccount.com',
    GOOGLE_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\\nfake\\n-----END RSA PRIVATE KEY-----',
    GOOGLE_CALENDAR_ID: 'cal-id',
    TWILIO_ACCOUNT_SID: 'AC_test',
    TWILIO_AUTH_TOKEN: 'auth',
    TWILIO_FROM_NUMBER: '+15551234567',
    NOTIFICATION_PHONE_NUMBER: '+15559876543',
  };

  beforeEach(() => {
    vi.resetModules();
    // Mock dotenv/config to prevent actual .env loading
    vi.mock('dotenv/config', () => ({}));
  });

  it('parses valid env successfully', async () => {
    // Set env vars
    const originalEnv = { ...process.env };
    Object.assign(process.env, validEnv);

    try {
      const { getConfig } = await import('../src/config.js');
      const config = getConfig();

      expect(config.IMAP_USER).toBe('user@yahoo.com');
      expect(config.IMAP_HOST).toBe('imap.mail.yahoo.com'); // default
      expect(config.IMAP_PORT).toBe(993); // default
      expect(config.SCHOOL_SENDER_DOMAINS).toEqual(['school.org', 'district.edu']);
      expect(config.POLL_INTERVAL_MINUTES).toBe(5); // default
      expect(config.LOG_LEVEL).toBe('info'); // default
    } finally {
      process.env = originalEnv;
    }
  });

  it('exits process on missing required fields', async () => {
    const originalEnv = { ...process.env };
    // Clear all env vars that config needs
    for (const key of Object.keys(validEnv)) {
      delete process.env[key];
    }

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { getConfig } = await import('../src/config.js');
      expect(() => getConfig()).toThrow('process.exit called');
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      mockExit.mockRestore();
      mockConsoleError.mockRestore();
      process.env = originalEnv;
    }
  });

  it('applies defaults correctly', async () => {
    const originalEnv = { ...process.env };
    Object.assign(process.env, validEnv);

    try {
      const { getConfig } = await import('../src/config.js');
      const config = getConfig();

      expect(config.TIMEZONE).toBe('America/New_York');
      expect(config.MORNING_REMINDER_HOUR).toBe(7);
      expect(config.DB_PATH).toBe('./kid-cal.db');
      expect(config.CLAUDE_MODEL).toBe('claude-sonnet-4-5-20250929');
      expect(config.SCHOOL_SENDER_ADDRESSES).toEqual([]);
      expect(config.REMINDER_CHECK_INTERVAL_MINUTES).toBe(15);
    } finally {
      process.env = originalEnv;
    }
  });
});
