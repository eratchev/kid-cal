import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    IMAP_HOST: 'imap.test.com',
    IMAP_PORT: 993,
    IMAP_USER: 'testuser@test.com',
    IMAP_PASSWORD: 'password',
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

const mockConnect = vi.fn();
const mockLogout = vi.fn();
const mockGetMailboxLock = vi.fn();
const mockFetch = vi.fn();
const mockMessageFlagsAdd = vi.fn();

vi.mock('imapflow', () => ({
  ImapFlow: class MockImapFlow {
    connect = mockConnect;
    logout = mockLogout;
    getMailboxLock = mockGetMailboxLock;
    fetch = mockFetch;
    messageFlagsAdd = mockMessageFlagsAdd;
    on = vi.fn();
    usable = true;
    constructor() {}
  },
}));

import { EmailPoller } from '../../src/email/poller.js';

describe('EmailPoller', () => {
  let poller: EmailPoller;
  const mockRelease = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMailboxLock.mockResolvedValue({ release: mockRelease });
    poller = new EmailPoller();
  });

  describe('connect', () => {
    it('creates client and connects', async () => {
      await poller.connect();
      expect(mockConnect).toHaveBeenCalled();
    });
  });

  describe('fetchUnseen', () => {
    it('throws when not connected', async () => {
      // New poller has no client (connect not called)
      await expect(poller.fetchUnseen()).rejects.toThrow('IMAP client not connected');
    });

    it('returns parsed RawEmail array', async () => {
      await poller.connect();

      const mockMessages = [
        {
          uid: 1,
          envelope: {
            from: [{ name: 'Teacher', address: 'teacher@school.org' }],
            subject: 'Field Trip',
            date: new Date('2025-04-01'),
            messageId: 'msg-1',
          },
          source: Buffer.from('email source'),
        },
      ];

      // Make fetch return an async iterable
      mockFetch.mockReturnValue((async function* () {
        for (const msg of mockMessages) yield msg;
      })());

      const emails = await poller.fetchUnseen();
      expect(emails).toHaveLength(1);
      expect(emails[0].uid).toBe(1);
      expect(emails[0].messageId).toBe('msg-1');
      expect(emails[0].envelope.subject).toBe('Field Trip');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('skips messages missing envelope or source', async () => {
      await poller.connect();

      mockFetch.mockReturnValue((async function* () {
        yield { uid: 1, envelope: null, source: Buffer.from('x') };
        yield { uid: 2, envelope: { from: [], subject: 'Test', date: new Date() }, source: null };
      })());

      const emails = await poller.fetchUnseen();
      expect(emails).toHaveLength(0);
    });

    it('generates fallback messageId with IMAP_USER prefix', async () => {
      await poller.connect();

      const date = new Date('2025-04-01');
      mockFetch.mockReturnValue((async function* () {
        yield {
          uid: 42,
          envelope: {
            from: [{ address: 'a@b.com' }],
            subject: 'Test',
            date,
            messageId: undefined,
          },
          source: Buffer.from('data'),
        };
      })());

      const emails = await poller.fetchUnseen();
      expect(emails).toHaveLength(1);
      expect(emails[0].messageId).toBe(`testuser@test.com:42:${date.toISOString()}`);
    });
  });

  describe('markSeen', () => {
    it('throws when not connected', async () => {
      await expect(poller.markSeen(1)).rejects.toThrow('IMAP client not connected');
    });

    it('adds \\Seen flag', async () => {
      await poller.connect();
      await poller.markSeen(42);
      expect(mockMessageFlagsAdd).toHaveBeenCalledWith({ uid: 42 }, ['\\Seen'], { uid: true });
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('calls logout and nulls client', async () => {
      await poller.connect();
      await poller.disconnect();
      expect(mockLogout).toHaveBeenCalled();
      // After disconnect, fetchUnseen should throw
      await expect(poller.fetchUnseen()).rejects.toThrow('IMAP client not connected');
    });

    it('does nothing when already disconnected', async () => {
      await poller.disconnect(); // No error
      expect(mockLogout).not.toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('returns false before connect', () => {
      expect(poller.isConnected()).toBe(false);
    });

    it('returns true after connect (client.usable)', async () => {
      await poller.connect();
      expect(poller.isConnected()).toBe(true);
    });
  });
});
