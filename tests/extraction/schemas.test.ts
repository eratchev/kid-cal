import { describe, it, expect } from 'vitest';
import { extractedEventSchema, extractedActionItemSchema, extractionResultSchema } from '../../src/extraction/schemas.js';

describe('extractedEventSchema', () => {
  it('parses valid event', () => {
    const result = extractedEventSchema.safeParse({
      title: 'Field Trip',
      description: 'Zoo visit',
      start_date: '2025-04-15T09:00:00',
      end_date: null,
      all_day: false,
      location: 'City Zoo',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = extractedEventSchema.safeParse({
      title: 'Field Trip',
      // missing description, start_date, etc.
    });
    expect(result.success).toBe(false);
  });
});

describe('extractedActionItemSchema', () => {
  it('parses valid action item', () => {
    const result = extractedActionItemSchema.safeParse({
      title: 'Permission Slip',
      description: 'Sign and return',
      deadline: '2025-04-10',
      priority: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid priority', () => {
    const result = extractedActionItemSchema.safeParse({
      title: 'Test',
      description: 'Test',
      deadline: null,
      priority: 'urgent', // not in enum
    });
    expect(result.success).toBe(false);
  });
});

describe('extractionResultSchema', () => {
  it('parses valid extraction result', () => {
    const result = extractionResultSchema.safeParse({
      events: [],
      action_items: [],
      summary: 'No actionable items found.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing summary', () => {
    const result = extractionResultSchema.safeParse({
      events: [],
      action_items: [],
    });
    expect(result.success).toBe(false);
  });
});
