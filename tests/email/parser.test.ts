import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({ LOG_LEVEL: 'error' }),
}));
vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

const mockSimpleParser = vi.fn();
const mockConvert = vi.fn();

vi.mock('mailparser', () => ({
  simpleParser: (...args: unknown[]) => mockSimpleParser(...args),
}));
vi.mock('html-to-text', () => ({
  convert: (...args: unknown[]) => mockConvert(...args),
}));

import { parseEmail } from '../../src/email/parser.js';
import type { RawEmail } from '../../src/email/poller.js';

function makeRaw(overrides: Partial<RawEmail> = {}): RawEmail {
  return {
    uid: 1,
    messageId: 'raw-msg-id',
    envelope: {
      from: [{ name: 'Teacher', address: 'teacher@school.org' }],
      subject: 'Field Trip',
      date: new Date('2025-04-01'),
    },
    source: Buffer.from('raw email source'),
    ...overrides,
  };
}

describe('parseEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('converts HTML email via html-to-text', async () => {
    mockSimpleParser.mockResolvedValue({
      from: { value: [{ address: 'teacher@school.org' }] },
      html: '<p>Hello</p>',
      text: 'Hello',
      messageId: 'parsed-id',
      subject: 'Test Subject',
      date: new Date('2025-04-01'),
    });
    mockConvert.mockReturnValue('Hello cleaned');

    const result = await parseEmail(makeRaw());

    expect(mockConvert).toHaveBeenCalledWith('<p>Hello</p>', expect.any(Object));
    expect(result.cleanText).toBe('Hello cleaned');
    expect(result.htmlBody).toBe('<p>Hello</p>');
  });

  it('falls back to textBody when no HTML', async () => {
    mockSimpleParser.mockResolvedValue({
      from: { value: [{ address: 'teacher@school.org' }] },
      html: false,
      text: 'Plain text body',
      messageId: 'parsed-id',
      subject: 'Test',
      date: new Date('2025-04-01'),
    });

    const result = await parseEmail(makeRaw());

    expect(mockConvert).not.toHaveBeenCalled();
    expect(result.cleanText).toBe('Plain text body');
    expect(result.htmlBody).toBe('');
  });

  it('extracts from address from parsed.from', async () => {
    mockSimpleParser.mockResolvedValue({
      from: { value: [{ address: 'specific@example.com' }] },
      html: false,
      text: '',
      messageId: 'id',
      subject: 'S',
      date: new Date(),
    });

    const result = await parseEmail(makeRaw());
    expect(result.from).toBe('specific@example.com');
  });

  it('falls back to envelope from when parsed.from is missing', async () => {
    mockSimpleParser.mockResolvedValue({
      from: undefined,
      html: false,
      text: '',
      messageId: 'id',
      subject: 'S',
      date: new Date(),
    });

    const result = await parseEmail(makeRaw({
      envelope: {
        from: [{ address: 'envelope@school.org' }],
        subject: 'Envelope Subject',
        date: new Date(),
      },
    }));
    expect(result.from).toBe('envelope@school.org');
  });

  it('falls back to "unknown" when no from address at all', async () => {
    mockSimpleParser.mockResolvedValue({
      from: undefined,
      html: false,
      text: '',
      messageId: 'id',
      subject: 'S',
      date: new Date(),
    });

    const result = await parseEmail(makeRaw({
      envelope: {
        from: [{}],
        subject: 'S',
        date: new Date(),
      },
    }));
    expect(result.from).toBe('unknown');
    expect(result.fromDomain).toBe('unknown');
  });

  it('extracts domain from email address', async () => {
    mockSimpleParser.mockResolvedValue({
      from: { value: [{ address: 'user@EXAMPLE.COM' }] },
      html: false,
      text: '',
      messageId: 'id',
      subject: 'S',
      date: new Date(),
    });

    const result = await parseEmail(makeRaw());
    expect(result.fromDomain).toBe('example.com');
  });

  it('uses parsed messageId over raw', async () => {
    mockSimpleParser.mockResolvedValue({
      from: { value: [{ address: 'a@b.com' }] },
      html: false,
      text: '',
      messageId: 'parsed-message-id',
      subject: 'S',
      date: new Date(),
    });

    const result = await parseEmail(makeRaw({ messageId: 'raw-id' }));
    expect(result.messageId).toBe('parsed-message-id');
  });

  it('falls back to raw messageId when parsed is missing', async () => {
    mockSimpleParser.mockResolvedValue({
      from: { value: [{ address: 'a@b.com' }] },
      html: false,
      text: '',
      messageId: undefined,
      subject: 'S',
      date: new Date(),
    });

    const result = await parseEmail(makeRaw({ messageId: 'raw-fallback-id' }));
    expect(result.messageId).toBe('raw-fallback-id');
  });

  it('falls back subject/date from envelope', async () => {
    const envelopeDate = new Date('2025-06-15');
    mockSimpleParser.mockResolvedValue({
      from: { value: [{ address: 'a@b.com' }] },
      html: false,
      text: '',
      messageId: 'id',
      subject: undefined,
      date: undefined,
    });

    const result = await parseEmail(makeRaw({
      envelope: {
        from: [{ address: 'a@b.com' }],
        subject: 'Envelope Subject',
        date: envelopeDate,
      },
    }));
    expect(result.subject).toBe('Envelope Subject');
    expect(result.date).toEqual(envelopeDate);
  });
});
