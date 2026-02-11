import { describe, it, expect } from 'vitest';
import { formatReminderMessage } from '../../src/reminders/templates.js';
import type { DueReminder } from '../../src/types.js';

describe('formatReminderMessage', () => {
  const baseReminder: DueReminder = {
    type: 'event',
    reminderType: 'week_before',
    itemId: 1,
    title: 'Science Fair',
    description: 'Annual science fair in the gym',
    date: '2025-04-15',
    location: 'School Gymnasium',
  };

  it('formats week_before reminder', () => {
    const msg = formatReminderMessage(baseReminder);
    expect(msg).toContain('NEXT WEEK');
    expect(msg).toContain('Science Fair');
    expect(msg).toContain('School Gymnasium');
  });

  it('formats day_before event reminder', () => {
    const msg = formatReminderMessage({ ...baseReminder, reminderType: 'day_before' });
    expect(msg).toContain('TOMORROW');
    expect(msg).toContain('Science Fair');
  });

  it('formats morning_of reminder', () => {
    const msg = formatReminderMessage({ ...baseReminder, reminderType: 'morning_of' });
    expect(msg).toContain('TODAY');
  });

  it('formats day_before action item reminder', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      type: 'action_item',
      reminderType: 'day_before',
      title: 'Return permission slip',
    });
    expect(msg).toContain('DUE TOMORROW');
    expect(msg).toContain('Return permission slip');
  });

  it('formats deadline_approaching reminder', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      type: 'action_item',
      reminderType: 'deadline_approaching',
      title: 'Book order',
    });
    expect(msg).toContain('DEADLINE IN 2 DAYS');
    expect(msg).toContain('Book order');
  });

  it('formats deadline_today reminder', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      type: 'action_item',
      reminderType: 'deadline_today',
      title: 'Turn in form',
    });
    expect(msg).toContain('DUE TODAY');
  });

  it('includes time for datetime events', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      date: '2025-04-15T14:30:00',
    });
    expect(msg).toContain('2:30 PM');
  });

  it('omits location when null', () => {
    const msg = formatReminderMessage({ ...baseReminder, location: null });
    expect(msg).not.toContain('📍');
  });

  it('handles unknown reminder type with default format', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      reminderType: 'unknown_type' as DueReminder['reminderType'],
    });
    expect(msg).toContain('Reminder:');
    expect(msg).toContain('Science Fair');
  });

  it('handles invalid date gracefully in all-day format', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      date: 'not-a-valid-date',
    });
    // Should fall back to raw string
    expect(msg).toContain('not-a-valid-date');
  });

  it('handles invalid date gracefully in datetime format', () => {
    const msg = formatReminderMessage({
      ...baseReminder,
      date: 'not-a-valid-dateT12:00:00',
    });
    // Should fall back to raw string
    expect(msg).toContain('not-a-valid-dateT12:00:00');
  });
});
