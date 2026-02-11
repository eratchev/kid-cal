import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildUserPrompt } from '../../src/extraction/prompt.js';
import type { ParsedEmail } from '../../src/types.js';

function makeEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    messageId: 'test-id',
    from: 'teacher@school.org',
    fromDomain: 'school.org',
    subject: 'Field Trip',
    date: new Date('2025-04-01T10:00:00Z'),
    textBody: 'Plain text fallback',
    htmlBody: '<p>Hello</p>',
    cleanText: 'Hello cleaned',
    ...overrides,
  };
}

describe('SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(SYSTEM_PROMPT).toBeTruthy();
    expect(typeof SYSTEM_PROMPT).toBe('string');
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });
});

describe('buildUserPrompt', () => {
  it('contains email from, subject, date, and timezone', () => {
    const prompt = buildUserPrompt(makeEmail(), 'America/New_York');

    expect(prompt).toContain('teacher@school.org');
    expect(prompt).toContain('Field Trip');
    expect(prompt).toContain('2025-04-01');
    expect(prompt).toContain('America/New_York');
  });

  it('uses cleanText when available', () => {
    const prompt = buildUserPrompt(makeEmail({ cleanText: 'Cleaned content', textBody: 'Raw text' }), 'UTC');
    expect(prompt).toContain('Cleaned content');
  });

  it('falls back to textBody when cleanText is empty', () => {
    const prompt = buildUserPrompt(makeEmail({ cleanText: '', textBody: 'Fallback text body' }), 'UTC');
    expect(prompt).toContain('Fallback text body');
  });
});
