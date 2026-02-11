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

    it('returns event reminders based on days until event', () => {
      const now = new Date();

      // Event happening tomorrow
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(now.getHours()); // Keep same hour to ensure daysUntil is ~1

      manager.saveEvent({
        title: 'Tomorrow Event',
        description: 'Happening tomorrow',
        startDate: tomorrow.toISOString(),
        endDate: null,
        allDay: false,
        location: 'School',
        sourceEmailId: 'email-1',
      });

      const reminders = manager.getDueReminders(now, 'America/New_York');

      // Should have day_before reminder
      const dayBefore = reminders.find(r => r.reminderType === 'day_before');
      expect(dayBefore).toBeDefined();
      expect(dayBefore!.title).toBe('Tomorrow Event');
      expect(dayBefore!.type).toBe('event');
      expect(dayBefore!.location).toBe('School');
    });

    it('returns action item reminders based on deadline', () => {
      const now = new Date();

      // Action item due tomorrow
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(now.getHours());

      manager.saveActionItem({
        title: 'Return Form',
        description: 'Sign it',
        deadline: tomorrow.toISOString(),
        priority: 'high',
        sourceEmailId: 'email-1',
      });

      const reminders = manager.getDueReminders(now, 'America/New_York');

      const dayBefore = reminders.find(r => r.reminderType === 'day_before' && r.type === 'action_item');
      expect(dayBefore).toBeDefined();
      expect(dayBefore!.title).toBe('Return Form');
      expect(dayBefore!.location).toBeNull();
    });

    it('does not return already-sent reminders', () => {
      const now = new Date();

      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(now.getHours());

      const event = manager.saveEvent({
        title: 'Already Reminded',
        description: 'Test',
        startDate: tomorrow.toISOString(),
        endDate: null,
        allDay: false,
        location: null,
        sourceEmailId: 'email-1',
      });

      // Mark day_before as already sent
      manager.saveReminder(event.id, null, 'day_before', 'SM_old');

      const reminders = manager.getDueReminders(now, 'America/New_York');
      const dayBefore = reminders.find(r => r.reminderType === 'day_before' && r.itemId === event.id);
      expect(dayBefore).toBeUndefined();
    });

    it('returns empty array when no upcoming items', () => {
      const reminders = manager.getDueReminders(new Date(), 'America/New_York');
      expect(reminders).toEqual([]);
    });
  });
});
