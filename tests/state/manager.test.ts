import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../src/state/database.js';
import { StateManager } from '../../src/state/manager.js';
import { formatInTimeZone } from 'date-fns-tz';

// Mock config and logger before importing modules that use them
import { vi } from 'vitest';
vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    DB_PATH: ':memory:',
    LOG_LEVEL: 'error',
    TIMEZONE: 'America/New_York',
    MORNING_REMINDER_HOUR: 7,
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

describe('StateManager', () => {
  function toLocalISO(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  let db: Database.Database;
  let manager: StateManager;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
    manager = new StateManager(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('isProcessed', () => {
    it('returns false for unknown message', () => {
      expect(manager.isProcessed('unknown-id')).toBe(false);
    });

    it('returns true after saving a processed email', () => {
      manager.saveProcessedEmail({
        messageId: 'test-123',
        from: 'teacher@school.org',
        subject: 'Field Trip',
        processedAt: new Date().toISOString(),
        status: 'success',
        errorMessage: null,
        eventCount: 1,
        actionItemCount: 0,
      });

      expect(manager.isProcessed('test-123')).toBe(true);
    });
  });

  describe('saveEvent / saveActionItem', () => {
    beforeEach(() => {
      // Need a processed email first (foreign key)
      manager.saveProcessedEmail({
        messageId: 'email-1',
        from: 'teacher@school.org',
        subject: 'Events',
        processedAt: new Date().toISOString(),
        status: 'success',
        errorMessage: null,
        eventCount: 1,
        actionItemCount: 1,
      });
    });

    it('saves and returns an event', () => {
      const stored = manager.saveEvent({
        title: 'Field Trip to Zoo',
        description: 'Class field trip',
        startDate: '2025-04-15T09:00:00',
        endDate: '2025-04-15T14:00:00',
        allDay: false,
        location: 'City Zoo',
        sourceEmailId: 'email-1',
      });

      expect(stored.id).toBe(1);
      expect(stored.title).toBe('Field Trip to Zoo');
      expect(stored.location).toBe('City Zoo');
    });

    it('saves and returns an action item', () => {
      const stored = manager.saveActionItem({
        title: 'Return permission slip',
        description: 'Sign and return by Friday',
        deadline: '2025-04-10',
        priority: 'high',
        sourceEmailId: 'email-1',
      });

      expect(stored.id).toBe(1);
      expect(stored.title).toBe('Return permission slip');
      expect(stored.priority).toBe('high');
    });
  });

  describe('findDuplicateEvent / findDuplicateActionItem', () => {
    beforeEach(() => {
      manager.saveProcessedEmail({
        messageId: 'email-1',
        from: 'teacher@school.org',
        subject: 'Events',
        processedAt: new Date().toISOString(),
        status: 'success',
        errorMessage: null,
        eventCount: 1,
        actionItemCount: 1,
      });
    });

    it('returns null when no matching event exists', () => {
      expect(manager.findDuplicateEvent('Field Trip', '2025-04-15T09:00:00')).toBeNull();
    });

    it('finds duplicate event by title and date (case-insensitive, ignoring time)', () => {
      manager.saveEvent({
        title: 'Field Trip to Zoo',
        description: 'Class trip',
        startDate: '2025-04-15T09:00:00',
        endDate: null,
        allDay: false,
        location: 'Zoo',
        sourceEmailId: 'email-1',
      });

      // Same title, same date, different time
      const dup = manager.findDuplicateEvent('field trip to zoo', '2025-04-15T14:00:00');
      expect(dup).not.toBeNull();
      expect(dup!.title).toBe('Field Trip to Zoo');
    });

    it('does not match events with different dates', () => {
      manager.saveEvent({
        title: 'Field Trip',
        description: 'Trip',
        startDate: '2025-04-15T09:00:00',
        endDate: null,
        allDay: false,
        location: null,
        sourceEmailId: 'email-1',
      });

      expect(manager.findDuplicateEvent('Field Trip', '2025-04-16T09:00:00')).toBeNull();
    });

    it('returns null for action item with no deadline', () => {
      expect(manager.findDuplicateActionItem('Some Task', null)).toBeNull();
    });

    it('finds duplicate action item by title and deadline', () => {
      manager.saveActionItem({
        title: 'Return Permission Slip',
        description: 'Sign and return',
        deadline: '2025-04-10T00:00:00',
        priority: 'high',
        sourceEmailId: 'email-1',
      });

      const dup = manager.findDuplicateActionItem('return permission slip', '2025-04-10T12:00:00');
      expect(dup).not.toBeNull();
      expect(dup!.title).toBe('Return Permission Slip');
    });
  });

  describe('isReminderSent / saveReminder', () => {
    beforeEach(() => {
      manager.saveProcessedEmail({
        messageId: 'email-1',
        from: 'teacher@school.org',
        subject: 'Test',
        processedAt: new Date().toISOString(),
        status: 'success',
        errorMessage: null,
        eventCount: 1,
        actionItemCount: 0,
      });
      manager.saveEvent({
        title: 'Test Event',
        description: 'Test',
        startDate: '2025-04-15T09:00:00',
        endDate: null,
        allDay: false,
        location: null,
        sourceEmailId: 'email-1',
      });
    });

    it('returns false when no reminder sent', () => {
      expect(manager.isReminderSent(1, null, 'week_before')).toBe(false);
    });

    it('returns true after saving a reminder', () => {
      manager.saveReminder(1, null, 'week_before', 'SM123');
      expect(manager.isReminderSent(1, null, 'week_before')).toBe(true);
    });

    it('different reminder types are tracked independently', () => {
      manager.saveReminder(1, null, 'week_before', 'SM123');
      expect(manager.isReminderSent(1, null, 'week_before')).toBe(true);
      expect(manager.isReminderSent(1, null, 'day_before')).toBe(false);
    });

    it('tracks action item reminders separately', () => {
      manager.saveActionItem({
        title: 'Test Action',
        description: 'Test',
        deadline: '2025-04-15',
        priority: 'high',
        sourceEmailId: 'email-1',
      });

      expect(manager.isReminderSent(null, 1, 'deadline_today')).toBe(false);
      manager.saveReminder(null, 1, 'deadline_today', 'SM456');
      expect(manager.isReminderSent(null, 1, 'deadline_today')).toBe(true);
    });

    it('returns false when both eventId and actionItemId are null', () => {
      expect(manager.isReminderSent(null, null, 'week_before')).toBe(false);
    });
  });

  describe('updateEventCalendarId / updateActionItemCalendarId', () => {
    beforeEach(() => {
      manager.saveProcessedEmail({
        messageId: 'email-1',
        from: 'teacher@school.org',
        subject: 'Test',
        processedAt: new Date().toISOString(),
        status: 'success',
        errorMessage: null,
        eventCount: 1,
        actionItemCount: 1,
      });
    });

    it('updates event calendar id', () => {
      const event = manager.saveEvent({
        title: 'Test Event',
        description: 'Test',
        startDate: '2025-04-15T09:00:00',
        endDate: null,
        allDay: false,
        location: null,
        sourceEmailId: 'email-1',
      });

      manager.updateEventCalendarId(event.id, 'cal-123');

      const updated = db.prepare('SELECT calendar_event_id FROM events WHERE id = ?').get(event.id) as { calendar_event_id: string };
      expect(updated.calendar_event_id).toBe('cal-123');
    });

    it('updates action item calendar id', () => {
      const item = manager.saveActionItem({
        title: 'Test Action',
        description: 'Test',
        deadline: '2025-04-15',
        priority: 'medium',
        sourceEmailId: 'email-1',
      });

      manager.updateActionItemCalendarId(item.id, 'cal-456');

      const updated = db.prepare('SELECT calendar_event_id FROM action_items WHERE id = ?').get(item.id) as { calendar_event_id: string };
      expect(updated.calendar_event_id).toBe('cal-456');
    });
  });

  describe('transaction', () => {
    it('commits on success', () => {
      manager.saveProcessedEmail({
        messageId: 'email-1',
        from: 'teacher@school.org',
        subject: 'Test',
        processedAt: new Date().toISOString(),
        status: 'success',
        errorMessage: null,
        eventCount: 0,
        actionItemCount: 0,
      });

      manager.transaction(() => {
        manager.saveProcessedEmail({
          messageId: 'email-2',
          from: 'admin@school.org',
          subject: 'Test 2',
          processedAt: new Date().toISOString(),
          status: 'success',
          errorMessage: null,
          eventCount: 0,
          actionItemCount: 0,
        });
      });

      expect(manager.isProcessed('email-2')).toBe(true);
    });

    it('rolls back on error', () => {
      manager.saveProcessedEmail({
        messageId: 'email-1',
        from: 'teacher@school.org',
        subject: 'Test',
        processedAt: new Date().toISOString(),
        status: 'success',
        errorMessage: null,
        eventCount: 0,
        actionItemCount: 0,
      });

      expect(() => {
        manager.transaction(() => {
          manager.saveProcessedEmail({
            messageId: 'email-rollback',
            from: 'admin@school.org',
            subject: 'Rollback Test',
            processedAt: new Date().toISOString(),
            status: 'success',
            errorMessage: null,
            eventCount: 0,
            actionItemCount: 0,
          });
          throw new Error('deliberate error');
        });
      }).toThrow('deliberate error');

      expect(manager.isProcessed('email-rollback')).toBe(false);
    });
  });

  describe('getDueReminders', () => {
    beforeEach(() => {
      manager.saveProcessedEmail({
        messageId: 'email-1',
        from: 'teacher@school.org',
        subject: 'Events',
        processedAt: new Date().toISOString(),
        status: 'success',
        errorMessage: null,
        eventCount: 1,
        actionItemCount: 1,
      });
    });

    // These reminders are "on the day the thing happens". They are driven entirely by the
    // `now` argument, so every case below is deterministic regardless of the host clock or
    // the host's timezone.
    const TZ = 'America/New_York';
    const NOW = new Date('2026-03-15T18:00:00Z'); // 14:00 on 2026-03-15 in New York

    function addEvent(startDate: string, overrides: Record<string, unknown> = {}) {
      return manager.saveEvent({
        title: 'Event',
        description: '',
        startDate,
        endDate: null,
        allDay: false,
        location: null,
        sourceEmailId: 'email-1',
        ...overrides,
      } as Parameters<typeof manager.saveEvent>[0]);
    }

    function addActionItem(deadline: string) {
      return manager.saveActionItem({
        title: 'Task',
        description: '',
        deadline,
        priority: 'high',
        sourceEmailId: 'email-1',
      });
    }

    const typesFor = (id: number, now = NOW) =>
      manager.getDueReminders(now, TZ).filter(r => r.itemId === id).map(r => r.reminderType);

    it('returns morning_of for a timed event later today', () => {
      const event = addEvent('2026-03-15T16:00:00', { title: 'Today Event', location: 'School' });

      const reminders = manager.getDueReminders(NOW, TZ);
      const r = reminders.find(x => x.reminderType === 'morning_of');

      expect(r).toBeDefined();
      expect(r!.title).toBe('Today Event');
      expect(r!.type).toBe('event');
      expect(r!.location).toBe('School');
      expect(r!.itemId).toBe(event.id);
    });

    // Regression: morning_of used a "within 24 hours" test, so an event tomorrow morning
    // was announced as "TODAY" during today's reminder window — and because the send was
    // then recorded, no reminder arrived on the actual day.
    it('does NOT return morning_of for an event tomorrow', () => {
      const event = addEvent('2026-03-16T09:00:00');

      expect(typesFor(event.id)).not.toContain('morning_of');
    });

    it('does NOT return morning_of for an event yesterday', () => {
      const event = addEvent('2026-03-14T09:00:00');

      expect(typesFor(event.id)).not.toContain('morning_of');
    });

    it('returns morning_of for an all-day event dated today', () => {
      const event = addEvent('2026-03-15T00:00:00', { allDay: true });

      expect(typesFor(event.id)).toContain('morning_of');
    });

    it('returns morning_of for an event that already started earlier today', () => {
      const event = addEvent('2026-03-15T09:00:00');

      expect(typesFor(event.id)).toContain('morning_of');
    });

    it('does not return an already-sent morning_of reminder', () => {
      const event = addEvent('2026-03-15T16:00:00');
      manager.saveReminder(event.id, null, 'morning_of', 'MSG_old');

      expect(typesFor(event.id)).not.toContain('morning_of');
    });

    it('returns deadline_today for an action item due today', () => {
      const item = addActionItem('2026-03-15T23:59:59');

      const reminders = manager.getDueReminders(NOW, TZ);
      const r = reminders.find(x => x.reminderType === 'deadline_today');

      expect(r).toBeDefined();
      expect(r!.type).toBe('action_item');
      expect(r!.itemId).toBe(item.id);
    });

    it('does NOT return deadline_today for an action item due tomorrow', () => {
      const item = addActionItem('2026-03-16T09:00:00');

      expect(typesFor(item.id)).not.toContain('deadline_today');
    });

    // The whole point of the timezone argument: the same instant is a different calendar
    // day depending on the zone, and the school's zone is the one that matters.
    it('uses the supplied timezone to decide which day it is', () => {
      // 01:30 UTC on the 16th is still 21:30 on the 15th in New York.
      const lateEvening = new Date('2026-03-16T01:30:00Z');
      const eventOn15th = addEvent('2026-03-15T20:00:00', { title: 'On the 15th' });
      const eventOn16th = addEvent('2026-03-16T20:00:00', { title: 'On the 16th' });

      const inNewYork = manager.getDueReminders(lateEvening, 'America/New_York');
      expect(inNewYork.map(r => r.title)).toContain('On the 15th');
      expect(inNewYork.map(r => r.title)).not.toContain('On the 16th');

      const inUtc = manager.getDueReminders(lateEvening, 'UTC');
      expect(inUtc.map(r => r.title)).toContain('On the 16th');
      expect(inUtc.map(r => r.title)).not.toContain('On the 15th');
    });

    it('returns empty array when no upcoming items', () => {
      const reminders = manager.getDueReminders(new Date(), 'America/New_York');
      expect(reminders).toEqual([]);
    });

    it('does NOT fire week_before for an event 7 days away', () => {
      const startDate = toLocalISO(new Date(Date.now() + 7 * 24 * 60 * 60_000));

      manager.saveEvent({
        title: 'Far Event',
        description: '',
        startDate,
        endDate: null,
        allDay: false,
        location: null,
        sourceEmailId: 'email-1',
      });

      const reminders = manager.getDueReminders(new Date(), TZ);
      expect(reminders.find(r => r.reminderType === 'week_before')).toBeUndefined();
      // Also confirm no other day-based reminder fires for this event
      expect(reminders.find(r => r.reminderType === 'morning_of')).toBeUndefined();
    });

    it('does NOT fire deadline_approaching for an action item 2 days away', () => {
      const deadline = toLocalISO(new Date(Date.now() + 2 * 24 * 60 * 60_000));

      manager.saveActionItem({
        title: 'Future Task',
        description: '',
        deadline,
        priority: 'low',
        sourceEmailId: 'email-1',
      });

      const reminders = manager.getDueReminders(new Date(), TZ);
      expect(reminders.find(r => r.reminderType === 'deadline_approaching')).toBeUndefined();
      expect(reminders.find(r => r.reminderType === 'deadline_today')).toBeUndefined();
    });
  });

  describe('getDueReminders - fifteen_min_before', () => {
    // The school timezone is deliberately NOT the host's, so these fail if the window is
    // ever computed from the host clock again. 17:00Z is 13:00 EDT on this date.
    const TZ = 'America/New_York';
    const NOW = new Date('2026-03-15T17:00:00Z');

    // The wall-clock string the daemon would have stored for an event `offsetMin` from NOW.
    function wallClock(offsetMin: number, at = NOW, tz = TZ): string {
      return formatInTimeZone(new Date(at.getTime() + offsetMin * 60_000), tz, "yyyy-MM-dd'T'HH:mm:ss");
    }

    function insertTimedEvent(offsetMin: number, allDay = false) {
      return manager.saveEvent({
        title: `Event in ${offsetMin}min`,
        description: 'Test event',
        startDate: wallClock(offsetMin),
        endDate: null,
        allDay,
        location: 'Room 1',
        sourceEmailId: 'email-fmb',
      });
    }

    const fired = (now = NOW, tz = TZ) =>
      manager.getDueReminders(now, tz).find(r => r.reminderType === 'fifteen_min_before');

    beforeEach(() => {
      manager.saveProcessedEmail({
        messageId: 'email-fmb',
        from: 'teacher@school.org',
        subject: 'Meeting',
        processedAt: new Date().toISOString(),
        status: 'success',
        errorMessage: null,
        eventCount: 1,
        actionItemCount: 0,
      });
    });

    it('fires for a timed event starting in 10 minutes', () => {
      insertTimedEvent(10);
      expect(fired()?.title).toBe('Event in 10min');
    });

    it('fires at exactly +20 minutes (closed upper bound)', () => {
      insertTimedEvent(20);
      expect(fired()).toBeDefined();
    });

    it('does NOT fire at +21 minutes', () => {
      insertTimedEvent(21);
      expect(fired()).toBeUndefined();
    });

    it('fires at exactly -30 minutes (closed lower bound, catch-up)', () => {
      insertTimedEvent(-30);
      expect(fired()).toBeDefined();
    });

    it('does NOT fire at -31 minutes (outside catch-up window)', () => {
      insertTimedEvent(-31);
      expect(fired()).toBeUndefined();
    });

    it('fires for an event that started 15 minutes ago (within catch-up)', () => {
      insertTimedEvent(-15);
      expect(fired()).toBeDefined();
    });

    it('does NOT fire for an all-day event even if its start_date is within the window', () => {
      insertTimedEvent(10, true);
      expect(fired()).toBeUndefined();
    });

    it('does NOT fire if already sent', () => {
      const event = insertTimedEvent(10);
      manager.saveReminder(event.id, null, 'fifteen_min_before', 'MSG_old');
      expect(fired()).toBeUndefined();
    });

    it('returns both morning_of and fifteen_min_before for an event starting in 10 minutes', () => {
      insertTimedEvent(10);
      const reminders = manager.getDueReminders(NOW, TZ);
      expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeDefined();
      expect(reminders.find(r => r.reminderType === 'morning_of')).toBeDefined();
    });

    // Regression: the window was built from the host clock, so on a host in any other
    // timezone (a UTC Linux server, say) the 15-minute alert silently never fired.
    it('uses the school timezone, not the host timezone', () => {
      manager.saveEvent({
        title: 'Meeting',
        description: '',
        startDate: wallClock(10),      // 13:10 in New York
        endDate: null,
        allDay: false,
        location: null,
        sourceEmailId: 'email-fmb',
      });

      expect(fired(NOW, 'America/New_York')).toBeDefined();
      // Same instant, same row — read as another zone the event is hours away.
      expect(fired(NOW, 'America/Los_Angeles')).toBeUndefined();
    });

    it('handles a standard-time (non-DST) offset correctly', () => {
      const january = new Date('2026-01-15T18:00:00Z'); // 13:00 EST, offset -5 not -4
      manager.saveEvent({
        title: 'Winter Meeting',
        description: '',
        startDate: wallClock(10, january),
        endDate: null,
        allDay: false,
        location: null,
        sourceEmailId: 'email-fmb',
      });

      expect(fired(january)?.title).toBe('Winter Meeting');
    });
  });
});
