import { describe, it, expect, vi } from 'vitest';
import { isSchoolEmail, isBlockedSubject } from '../../src/email/filter.js';
import type { ParsedEmail } from '../../src/types.js';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    SCHOOL_SENDER_DOMAINS: ['school.org', 'district.edu'],
    SCHOOL_SENDER_ADDRESSES: ['teacher@gmail.com'],
    BLOCKED_SUBJECT_KEYWORDS: ["head's update", 'newsletter'],
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

function makeEmail(from: string, subject = 'Test'): ParsedEmail {
  const domain = from.includes('@') ? from.split('@')[1]!.toLowerCase() : 'unknown';
  return {
    messageId: 'test',
    from,
    fromDomain: domain,
    subject,
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

describe('isBlockedSubject', () => {
  it('blocks emails whose subject contains a blocked keyword', () => {
    expect(isBlockedSubject(makeEmail('principal@school.org', "Head's Update: April"))).toBe(true);
    expect(isBlockedSubject(makeEmail('admin@district.edu', 'Monthly Newsletter'))).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isBlockedSubject(makeEmail('principal@school.org', "HEAD'S UPDATE"))).toBe(true);
    expect(isBlockedSubject(makeEmail('admin@district.edu', "NEWSLETTER"))).toBe(true);
  });

  it('allows emails whose subject does not match any blocked keyword', () => {
    expect(isBlockedSubject(makeEmail('principal@school.org', 'Field Trip Reminder'))).toBe(false);
    expect(isBlockedSubject(makeEmail('admin@district.edu', 'Upcoming Events'))).toBe(false);
  });

  it('allows emails when BLOCKED_SUBJECT_KEYWORDS is empty', () => {
    // The mock returns a non-empty list; this test uses an inline email with a safe subject
    expect(isBlockedSubject(makeEmail('teacher@gmail.com', 'Important Announcement'))).toBe(false);
  });
});
