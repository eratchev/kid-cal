import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    ANTHROPIC_API_KEY: 'test-key',
    CLAUDE_MODEL: 'claude-sonnet-4-5-20250929',
    TIMEZONE: 'America/New_York',
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

const mockParse = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { parse: mockParse };
    constructor() {}
  },
}));
vi.mock('@anthropic-ai/sdk/helpers/zod', () => ({
  zodOutputFormat: vi.fn().mockReturnValue({ type: 'json_schema' }),
}));

import { extractFromEmail } from '../../src/extraction/extractor.js';
import type { ParsedEmail } from '../../src/types.js';

function makeEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    messageId: 'test-email-id',
    from: 'teacher@school.org',
    fromDomain: 'school.org',
    subject: 'Field Trip',
    date: new Date('2025-04-01'),
    textBody: 'Field trip to the zoo on April 15.',
    htmlBody: '',
    cleanText: 'Field trip to the zoo on April 15.',
    ...overrides,
  };
}

describe('extractFromEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps snake_case schema output to camelCase types', async () => {
    mockParse.mockResolvedValue({
      parsed_output: {
        events: [
          {
            title: 'Zoo Trip',
            description: 'Class field trip',
            start_date: '2025-04-15T09:00:00',
            end_date: '2025-04-15T14:00:00',
            all_day: false,
            location: 'City Zoo',
          },
        ],
        action_items: [
          {
            title: 'Permission Slip',
            description: 'Sign and return',
            deadline: '2025-04-10',
            priority: 'high',
          },
        ],
        summary: 'Field trip to the zoo.',
      },
    });

    const result = await extractFromEmail(makeEmail());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].startDate).toBe('2025-04-15T09:00:00');
    expect(result.events[0].endDate).toBe('2025-04-15T14:00:00');
    expect(result.events[0].allDay).toBe(false);
    expect(result.events[0].sourceEmailId).toBe('test-email-id');

    expect(result.actionItems).toHaveLength(1);
    expect(result.actionItems[0].priority).toBe('high');
    expect(result.actionItems[0].sourceEmailId).toBe('test-email-id');

    expect(result.summary).toBe('Field trip to the zoo.');
    expect(result.extractionFailed).toBeUndefined();
  });

  it('returns extractionFailed when no parsed output', async () => {
    mockParse.mockResolvedValue({
      parsed_output: null,
      stop_reason: 'max_tokens',
    });

    const result = await extractFromEmail(makeEmail());

    expect(result.extractionFailed).toBe(true);
    expect(result.events).toHaveLength(0);
    expect(result.actionItems).toHaveLength(0);
  });

  it('attaches sourceEmailId to each event and action item', async () => {
    mockParse.mockResolvedValue({
      parsed_output: {
        events: [
          { title: 'E1', description: '', start_date: '2025-04-15', end_date: null, all_day: true, location: null },
          { title: 'E2', description: '', start_date: '2025-04-16', end_date: null, all_day: true, location: null },
        ],
        action_items: [
          { title: 'A1', description: '', deadline: null, priority: 'low' },
        ],
        summary: 'Test',
      },
    });

    const result = await extractFromEmail(makeEmail({ messageId: 'custom-id' }));

    for (const event of result.events) {
      expect(event.sourceEmailId).toBe('custom-id');
    }
    for (const item of result.actionItems) {
      expect(item.sourceEmailId).toBe('custom-id');
    }
  });
});
