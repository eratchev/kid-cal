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
import { formatInTimeZone } from 'date-fns-tz';
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

  private pushIfUnsent(
    into: DueReminder[],
    reminder: DueReminder,
    eventId: number | null,
    actionItemId: number | null,
  ): void {
    if (!this.isReminderSent(eventId, actionItemId, reminder.reminderType)) {
      into.push(reminder);
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

  /**
   * Events on a given calendar day, e.g. '2026-03-15'.
   *
   * Stored dates are naive local ISO strings in the school's timezone, so matching on the
   * date part is exact — no instant arithmetic and no dependence on the host's timezone.
   */
  private getEventsOnDay(day: string): StoredEvent[] {
    return this.db.prepare(`
      SELECT * FROM events
      WHERE DATE(start_date) = ?
      ORDER BY start_date ASC
    `).all(day) as StoredEvent[];
  }

  private getActionItemsDueOnDay(day: string): StoredActionItem[] {
    return this.db.prepare(`
      SELECT * FROM action_items
      WHERE deadline IS NOT NULL AND DATE(deadline) = ?
      ORDER BY deadline ASC
    `).all(day) as StoredActionItem[];
  }

  private getEventsInMinuteWindow(fromMinutes: number, toMinutes: number): StoredEvent[] {
    return this.db.prepare(`
      SELECT * FROM events
      WHERE all_day = 0
        AND start_date >= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ? || ' minutes')
        AND start_date <= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ? || ' minutes')
      ORDER BY start_date ASC
    `).all(fromMinutes, toMinutes) as StoredEvent[];
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

    // "Today" is the calendar day in the school's timezone — not the host's, and not UTC.
    // Stored dates are naive local ISO strings in that same timezone, so a day-to-day
    // comparison is exact. The previous "within 24 hours" test announced tomorrow's events
    // as happening today, and then suppressed the reminder on the day itself.
    const today = formatInTimeZone(now, timezone, 'yyyy-MM-dd');

    for (const event of this.getEventsOnDay(today)) {
      this.pushIfUnsent(reminders, {
        type: 'event',
        reminderType: 'morning_of',
        itemId: event.id,
        title: event.title,
        description: event.description,
        date: event.start_date,
        location: event.location,
      }, event.id, null);
    }

    for (const item of this.getActionItemsDueOnDay(today)) {
      this.pushIfUnsent(reminders, {
        type: 'action_item',
        reminderType: 'deadline_today',
        itemId: item.id,
        title: item.title,
        description: item.description,
        date: item.deadline!,
        location: null,
      }, null, item.id);
    }

    // fifteen_min_before: timed events starting within the next 20 min or up to 30 min ago.
    // The SQL window is a coarse filter; the minutesUntil check is defense-in-depth using
    // JS Date arithmetic (both use local time via new Date(unzoned string)).
    // nowSec truncates sub-second precision to match the second-level resolution of stored start_date strings.
    const nowSec = Math.floor(now.getTime() / 1000) * 1000;
    for (const event of this.getEventsInMinuteWindow(-30, 20)) {
      const minutesUntil = (new Date(event.start_date).getTime() - nowSec) / 60_000;
      if (minutesUntil < -30 || minutesUntil > 20) continue;

      this.pushIfUnsent(reminders, {
        type: 'event',
        reminderType: 'fifteen_min_before',
        itemId: event.id,
        title: event.title,
        description: event.description,
        date: event.start_date,
        location: event.location,
      }, event.id, null);
    }

    return reminders;
  }
}
