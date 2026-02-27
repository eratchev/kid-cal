import type Database from 'better-sqlite3';
import type {
  ExtractedEvent,
  ExtractedActionItem,
  StoredEvent,
  StoredActionItem,
  StoredProcessedEmail,
  ReminderType,
  DueReminder,
} from '../types.js';
import { getLogger } from '../logger.js';

function calcDaysUntil(target: Date, now: Date): number {
  return Math.floor((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export class StateManager {
  private db: Database.Database;
  private logger = getLogger();

  constructor(db: Database.Database) {
    this.db = db;
  }

  isProcessed(messageId: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM processed_emails WHERE message_id = ?'
    ).get(messageId);
    return !!row;
  }

  saveProcessedEmail(email: StoredProcessedEmail): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO processed_emails
        (message_id, "from", subject, processed_at, status, error_message, event_count, action_item_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      email.messageId,
      email.from,
      email.subject,
      email.processedAt,
      email.status,
      email.errorMessage,
      email.eventCount,
      email.actionItemCount,
    );
  }

  saveEvent(event: ExtractedEvent): StoredEvent {
    const result = this.db.prepare(`
      INSERT INTO events (email_message_id, title, description, start_date, end_date, all_day, location)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.sourceEmailId,
      event.title,
      event.description,
      event.startDate,
      event.endDate,
      event.allDay ? 1 : 0,
      event.location,
    );

    this.logger.info({ eventId: result.lastInsertRowid, title: event.title }, 'Saved event');

    return this.db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid) as StoredEvent;
  }

  saveActionItem(item: ExtractedActionItem): StoredActionItem {
    const result = this.db.prepare(`
      INSERT INTO action_items (email_message_id, title, description, deadline, priority)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      item.sourceEmailId,
      item.title,
      item.description,
      item.deadline,
      item.priority,
    );

    this.logger.info({ actionItemId: result.lastInsertRowid, title: item.title }, 'Saved action item');

    return this.db.prepare('SELECT * FROM action_items WHERE id = ?').get(result.lastInsertRowid) as StoredActionItem;
  }

  findDuplicateEvent(title: string, startDate: string): StoredEvent | null {
    const dateOnly = startDate.split('T')[0];
    const row = this.db.prepare(`
      SELECT * FROM events
      WHERE LOWER(title) = LOWER(?)
        AND DATE(start_date) = DATE(?)
      LIMIT 1
    `).get(title, dateOnly) as StoredEvent | undefined;
    return row ?? null;
  }

  findDuplicateActionItem(title: string, deadline: string | null): StoredActionItem | null {
    if (!deadline) return null;
    const dateOnly = deadline.split('T')[0];
    const row = this.db.prepare(`
      SELECT * FROM action_items
      WHERE LOWER(title) = LOWER(?)
        AND DATE(deadline) = DATE(?)
      LIMIT 1
    `).get(title, dateOnly) as StoredActionItem | undefined;
    return row ?? null;
  }

  updateEventCalendarId(eventId: number, calendarEventId: string): void {
    this.db.prepare(
      'UPDATE events SET calendar_event_id = ? WHERE id = ?'
    ).run(calendarEventId, eventId);
  }

  updateActionItemCalendarId(actionItemId: number, calendarEventId: string): void {
    this.db.prepare(
      'UPDATE action_items SET calendar_event_id = ? WHERE id = ?'
    ).run(calendarEventId, actionItemId);
  }

  /** Run a function inside a SQLite transaction (auto-rollback on throw). */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  isReminderSent(eventId: number | null, actionItemId: number | null, reminderType: ReminderType): boolean {
    if (eventId) {
      const row = this.db.prepare(
        'SELECT 1 FROM sent_reminders WHERE event_id = ? AND reminder_type = ?'
      ).get(eventId, reminderType);
      return !!row;
    }
    if (actionItemId) {
      const row = this.db.prepare(
        'SELECT 1 FROM sent_reminders WHERE action_item_id = ? AND reminder_type = ?'
      ).get(actionItemId, reminderType);
      return !!row;
    }
    return false;
  }

  private pushDueReminders(
    into: DueReminder[],
    checks: { type: ReminderType; condition: boolean }[],
    eventId: number | null,
    actionItemId: number | null,
    base: Omit<DueReminder, 'reminderType'>,
  ): void {
    for (const check of checks) {
      if (check.condition && !this.isReminderSent(eventId, actionItemId, check.type)) {
        into.push({ ...base, reminderType: check.type });
      }
    }
  }

  saveReminder(
    eventId: number | null,
    actionItemId: number | null,
    reminderType: ReminderType,
    notificationSid: string | null,
  ): void {
    this.db.prepare(`
      INSERT INTO sent_reminders (event_id, action_item_id, reminder_type, notification_sid)
      VALUES (?, ?, ?, ?)
    `).run(eventId, actionItemId, reminderType, notificationSid);
  }

  getUpcomingEvents(withinDays: number): StoredEvent[] {
    return this.db.prepare(`
      SELECT * FROM events
      WHERE start_date >= datetime('now')
        AND start_date <= datetime('now', '+' || ? || ' days')
      ORDER BY start_date ASC
    `).all(withinDays) as StoredEvent[];
  }

  getUpcomingActionItems(withinDays: number): StoredActionItem[] {
    return this.db.prepare(`
      SELECT * FROM action_items
      WHERE deadline IS NOT NULL
        AND deadline >= datetime('now')
        AND deadline <= datetime('now', '+' || ? || ' days')
      ORDER BY deadline ASC
    `).all(withinDays) as StoredActionItem[];
  }

  getEmailSubject(messageId: string): string {
    const row = this.db.prepare(
      'SELECT subject FROM processed_emails WHERE message_id = ?'
    ).get(messageId) as { subject: string } | undefined;
    return row?.subject ?? '(unknown)';
  }

  getOrphanedEvents(): StoredEvent[] {
    return this.db.prepare(
      'SELECT * FROM events WHERE calendar_event_id IS NULL'
    ).all() as StoredEvent[];
  }

  getOrphanedActionItems(): StoredActionItem[] {
    return this.db.prepare(
      'SELECT * FROM action_items WHERE calendar_event_id IS NULL'
    ).all() as StoredActionItem[];
  }

  getDueReminders(now: Date, timezone: string): DueReminder[] {
    const reminders: DueReminder[] = [];

    // Get events within the next 8 days (covers week_before + buffer)
    const events = this.getUpcomingEvents(8);
    for (const event of events) {
      const days = calcDaysUntil(new Date(event.start_date), now);
      this.pushDueReminders(reminders, [
        { type: 'week_before', condition: days <= 7 && days > 1 },
        { type: 'day_before',  condition: days <= 1 && days > 0 },
        { type: 'morning_of',  condition: days <= 0 && days > -1 },
      ], event.id, null, {
        type: 'event',
        itemId: event.id,
        title: event.title,
        description: event.description,
        date: event.start_date,
        location: event.location,
      });
    }

    // Get action items within the next 3 days (covers deadline_approaching + buffer)
    const actionItems = this.getUpcomingActionItems(3);
    for (const item of actionItems) {
      if (!item.deadline) continue;
      const days = calcDaysUntil(new Date(item.deadline), now);
      this.pushDueReminders(reminders, [
        { type: 'deadline_approaching', condition: days <= 2 && days > 1 },
        { type: 'day_before',           condition: days <= 1 && days > 0 },
        { type: 'deadline_today',       condition: days <= 0 && days > -1 },
      ], null, item.id, {
        type: 'action_item',
        itemId: item.id,
        title: item.title,
        description: item.description,
        date: item.deadline,
        location: null,
      });
    }

    return reminders;
  }
}
