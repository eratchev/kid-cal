import { describe, it, expect, vi } from 'vitest';
import { isSchoolEmail } from '../../src/email/filter.js';
import type { ParsedEmail } from '../../src/types.js';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    SCHOOL_SENDER_DOMAINS: ['school.org', 'district.edu'],
    SCHOOL_SENDER_ADDRESSES: ['teacher@gmail.com'],
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

function makeEmail(from: string): ParsedEmail {
  const domain = from.includes('@') ? from.split('@')[1]!.toLowerCase() : 'unknown';
  return {
    messageId: 'test',
    from,
    fromDomain: domain,
    subject: 'Test',
    date: new Date(),
    textBody: '',
    htmlBody: '',
    cleanText: '',
  };
}

describe('isSchoolEmail', () => {
  it('matches by domain', () => {
    expect(isSchoolEmail(makeEmail('principal@school.org'))).toBe(true);
    expect(isSchoolEmail(makeEmail('admin@district.edu'))).toBe(true);
  });

  it('matches by exact address', () => {
    expect(isSchoolEmail(makeEmail('teacher@gmail.com'))).toBe(true);
  });

  it('rejects non-school emails', () => {
    expect(isSchoolEmail(makeEmail('spam@marketing.com'))).toBe(false);
    expect(isSchoolEmail(makeEmail('random@yahoo.com'))).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSchoolEmail(makeEmail('Teacher@SCHOOL.ORG'))).toBe(true);
    expect(isSchoolEmail(makeEmail('TEACHER@GMAIL.COM'))).toBe(true);
  });
});
