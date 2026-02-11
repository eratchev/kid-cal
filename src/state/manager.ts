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

  saveReminder(
    eventId: number | null,
    actionItemId: number | null,
    reminderType: ReminderType,
    twilioMessageSid: string | null,
  ): void {
    this.db.prepare(`
      INSERT INTO sent_reminders (event_id, action_item_id, reminder_type, twilio_message_sid)
      VALUES (?, ?, ?, ?)
    `).run(eventId, actionItemId, reminderType, twilioMessageSid);
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
      const eventDate = new Date(event.start_date);
      const daysUntil = Math.floor((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      const checks: { type: ReminderType; condition: boolean }[] = [
        { type: 'week_before', condition: daysUntil <= 7 && daysUntil > 1 },
        { type: 'day_before', condition: daysUntil <= 1 && daysUntil > 0 },
        { type: 'morning_of', condition: daysUntil <= 0 && daysUntil > -1 },
      ];

      for (const check of checks) {
        if (check.condition && !this.isReminderSent(event.id, null, check.type)) {
          reminders.push({
            type: 'event',
            reminderType: check.type,
            itemId: event.id,
            title: event.title,
            description: event.description,
            date: event.start_date,
            location: event.location,
          });
        }
      }
    }

    // Get action items within the next 3 days (covers deadline_approaching + buffer)
    const actionItems = this.getUpcomingActionItems(3);
    for (const item of actionItems) {
      if (!item.deadline) continue;
      const deadlineDate = new Date(item.deadline);
      const daysUntil = Math.floor((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      const checks: { type: ReminderType; condition: boolean }[] = [
        { type: 'deadline_approaching', condition: daysUntil <= 2 && daysUntil > 1 },
        { type: 'day_before', condition: daysUntil <= 1 && daysUntil > 0 },
        { type: 'deadline_today', condition: daysUntil <= 0 && daysUntil > -1 },
      ];

      for (const check of checks) {
        if (check.condition && !this.isReminderSent(null, item.id, check.type)) {
          reminders.push({
            type: 'action_item',
            reminderType: check.type,
            itemId: item.id,
            title: item.title,
            description: item.description,
            date: item.deadline,
            location: null,
          });
        }
      }
    }

    return reminders;
  }
}
