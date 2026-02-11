export interface ParsedEmail {
  messageId: string;
  from: string;
  fromDomain: string;
  subject: string;
  date: Date;
  textBody: string;
  htmlBody: string;
  cleanText: string; // html-to-text output
}

export interface ExtractedEvent {
  title: string;
  description: string;
  startDate: string; // ISO 8601
  endDate: string | null; // ISO 8601, null for all-day
  allDay: boolean;
  location: string | null;
  sourceEmailId: string;
  sourceEmailSubject: string;
}

export interface ExtractedActionItem {
  title: string;
  description: string;
  deadline: string | null; // ISO 8601
  priority: 'high' | 'medium' | 'low';
  sourceEmailId: string;
  sourceEmailSubject: string;
}

export interface ExtractionResult {
  events: ExtractedEvent[];
  actionItems: ExtractedActionItem[];
  summary: string;
  extractionFailed?: boolean;
}

// Stored types use snake_case to match SQLite column names (better-sqlite3 returns raw columns)
export interface StoredEvent {
  id: number;
  email_message_id: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string | null;
  all_day: number; // SQLite boolean: 0 or 1
  location: string | null;
  calendar_event_id: string | null;
  created_at: string;
}

export interface StoredActionItem {
  id: number;
  email_message_id: string;
  title: string;
  description: string;
  deadline: string | null;
  priority: 'high' | 'medium' | 'low';
  calendar_event_id: string | null;
  created_at: string;
}

export interface StoredProcessedEmail {
  messageId: string;
  from: string;
  subject: string;
  processedAt: string;
  status: 'success' | 'failed';
  errorMessage: string | null;
  eventCount: number;
  actionItemCount: number;
}

export type ReminderType =
  | 'week_before'
  | 'day_before'
  | 'morning_of'
  | 'deadline_approaching'
  | 'deadline_today';

export interface StoredReminder {
  id: number;
  event_id: number | null;
  action_item_id: number | null;
  reminder_type: ReminderType;
  sent_at: string;
  twilio_message_sid: string | null;
}

export interface DueReminder {
  type: 'event' | 'action_item';
  reminderType: ReminderType;
  itemId: number;
  title: string;
  description: string;
  date: string; // The relevant date (start date or deadline)
  location: string | null;
}
