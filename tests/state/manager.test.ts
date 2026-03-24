import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../src/state/database.js';
import { StateManager } from '../../src/state/manager.js';

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

  describe('getUpcomingEvents / getUpcomingActionItems', () => {
    beforeEach(() => {
      manager.saveProcessedEmail({
        messageId: 'email-1',
        from: 'teacher@school.org',
        subject: 'Events',
        processedAt: new Date().toISOString(),
        status: 'success',
        errorMessage: null,
        eventCount: 2,
        actionItemCount: 1,
      });
    });

    it('returns events within the specified day range', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 10);

      manager.saveEvent({
        title: 'Tomorrow Event',
        description: 'Soon',
        startDate: tomorrow.toISOString(),
        endDate: null,
        allDay: false,
        location: null,
        sourceEmailId: 'email-1',
      });

      manager.saveEvent({
        title: 'Far Future Event',
        description: 'Later',
        startDate: nextWeek.toISOString(),
        endDate: null,
        allDay: false,
        location: null,
        sourceEmailId: 'email-1',
      });

      const within3Days = manager.getUpcomingEvents(3);
      expect(within3Days).toHaveLength(1);
      expect(within3Days[0].title).toBe('Tomorrow Event');

      const within15Days = manager.getUpcomingEvents(15);
      expect(within15Days).toHaveLength(2);
    });

    it('returns action items with deadlines within range', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      manager.saveActionItem({
        title: 'Due Soon',
        description: 'Deadline approaching',
        deadline: tomorrow.toISOString(),
        priority: 'high',
        sourceEmailId: 'email-1',
      });

      manager.saveActionItem({
        title: 'No Deadline',
        description: 'Optional',
        deadline: null,
        priority: 'low',
        sourceEmailId: 'email-1',
      });

      const upcoming = manager.getUpcomingActionItems(3);
      expect(upcoming).toHaveLength(1);
      expect(upcoming[0].title).toBe('Due Soon');
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

    it('returns morning_of reminder for a same-day timed event', () => {
      const now = new Date();
      // 2 hours from now → calcDaysUntil = Math.floor(2/24) = 0, satisfies morning_of
      const startDate = toLocalISO(new Date(Date.now() + 2 * 60 * 60_000));

      manager.saveEvent({
        title: 'Today Event',
        description: 'Happening today',
        startDate,
        endDate: null,
        allDay: false,
        location: 'School',
        sourceEmailId: 'email-1',
      });

      const reminders = manager.getDueReminders(now, 'America/New_York');

      const r = reminders.find(r => r.reminderType === 'morning_of');
      expect(r).toBeDefined();
      expect(r!.title).toBe('Today Event');
      expect(r!.type).toBe('event');
      expect(r!.location).toBe('School');
    });

    it('returns deadline_today reminder for a same-day action item deadline', () => {
      const now = new Date();
      const deadline = toLocalISO(new Date(Date.now() + 2 * 60 * 60_000));

      manager.saveActionItem({
        title: 'Return Form',
        description: 'Sign it',
        deadline,
        priority: 'high',
        sourceEmailId: 'email-1',
      });

      const reminders = manager.getDueReminders(now, 'America/New_York');

      const r = reminders.find(r => r.reminderType === 'deadline_today');
      expect(r).toBeDefined();
      expect(r!.title).toBe('Return Form');
      expect(r!.location).toBeNull();
    });

    it('does not return already-sent morning_of reminder', () => {
      const now = new Date();
      const startDate = toLocalISO(new Date(Date.now() + 2 * 60 * 60_000));

      const event = manager.saveEvent({
        title: 'Already Reminded',
        description: 'Test',
        startDate,
        endDate: null,
        allDay: false,
        location: null,
        sourceEmailId: 'email-1',
      });

      manager.saveReminder(event.id, null, 'morning_of', 'MSG_old');

      const reminders = manager.getDueReminders(now, 'America/New_York');
      expect(reminders.find(r => r.reminderType === 'morning_of' && r.itemId === event.id)).toBeUndefined();
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

      const reminders = manager.getDueReminders(new Date(), 'America/New_York');
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

      const reminders = manager.getDueReminders(new Date(), 'America/New_York');
      expect(reminders.find(r => r.reminderType === 'deadline_approaching')).toBeUndefined();
      expect(reminders.find(r => r.reminderType === 'deadline_today')).toBeUndefined();
    });
  });

  describe('getDueReminders - fifteen_min_before', () => {
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

    // Inserts a timed event (all_day=false) starting N minutes from now.
    // start_date must be local time (YYYY-MM-DDTHH:MM:SS, no timezone suffix) to match the
    // stored format AND the SQL strftime('now', 'localtime') comparison.
    // Do NOT use toISOString() — that returns UTC and will produce wrong comparisons in non-UTC environments.
    function insertTimedEvent(minutesFromNow: number): ReturnType<typeof manager.saveEvent> {
      const startDate = toLocalISO(new Date(Date.now() + minutesFromNow * 60_000));
      return manager.saveEvent({
        title: `Event in ${minutesFromNow}min`,
        description: 'Test event',
        startDate,
        endDate: null,
        allDay: false,
        location: 'Room 1',
        sourceEmailId: 'email-fmb',
      });
    }

    it('fires fifteen_min_before for a timed event starting in 10 minutes', () => {
      insertTimedEvent(10);
      const reminders = manager.getDueReminders(new Date(), 'America/New_York');
      const r = reminders.find(r => r.reminderType === 'fifteen_min_before');
      expect(r).toBeDefined();
      expect(r!.title).toBe('Event in 10min');
    });

    it('fires fifteen_min_before at exactly +20 minutes (closed upper bound)', () => {
      insertTimedEvent(20);
      const reminders = manager.getDueReminders(new Date(), 'America/New_York');
      expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeDefined();
    });

    it('does NOT fire at +21 minutes', () => {
      insertTimedEvent(21);
      const reminders = manager.getDueReminders(new Date(), 'America/New_York');
      expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeUndefined();
    });

    it('fires fifteen_min_before at exactly -30 minutes (closed lower bound, catch-up)', () => {
      insertTimedEvent(-30);
      const reminders = manager.getDueReminders(new Date(), 'America/New_York');
      expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeDefined();
    });

    it('does NOT fire at -31 minutes (outside catch-up window)', () => {
      insertTimedEvent(-31);
      const reminders = manager.getDueReminders(new Date(), 'America/New_York');
      expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeUndefined();
    });

    it('fires for an event that started 15 minutes ago (within catch-up)', () => {
      insertTimedEvent(-15);
      const reminders = manager.getDueReminders(new Date(), 'America/New_York');
      expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeDefined();
    });

    it('does NOT fire for an all-day event even if its start_date is within the window', () => {
      // Insert with allDay=true but start_date within window — SQL all_day=0 guard must exclude it.
      // Must use toLocalISO (not toISOString) so the stored value matches the localtime SQL window.
      const startDate = toLocalISO(new Date(Date.now() + 10 * 60_000));
      manager.saveEvent({
        title: 'All Day Event',
        description: 'No time',
        startDate,
        endDate: null,
        allDay: true,
        location: null,
        sourceEmailId: 'email-fmb',
      });
      const reminders = manager.getDueReminders(new Date(), 'America/New_York');
      expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeUndefined();
    });

    it('does NOT fire if already sent', () => {
      const event = insertTimedEvent(10);
      manager.saveReminder(event.id, null, 'fifteen_min_before', 'MSG_old');
      const reminders = manager.getDueReminders(new Date(), 'America/New_York');
      expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeUndefined();
    });

    it('returns both morning_of and fifteen_min_before for a timed event starting in 10 minutes', () => {
      // This test covers two code paths: getUpcomingEvents(1) produces morning_of,
      // getEventsInMinuteWindow(-30, 20) produces fifteen_min_before — both run in getDueReminders.
      insertTimedEvent(10);
      const reminders = manager.getDueReminders(new Date(), 'America/New_York');
      expect(reminders.find(r => r.reminderType === 'fifteen_min_before')).toBeDefined();
      expect(reminders.find(r => r.reminderType === 'morning_of')).toBeDefined();
    });
  });
});
