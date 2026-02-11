import { format, parseISO } from 'date-fns';
import type { DueReminder } from '../types.js';

function formatDate(isoDate: string): string {
  try {
    const date = parseISO(isoDate);
    return format(date, 'EEE, MMM d');
  } catch {
    return isoDate;
  }
}

function formatDateTime(isoDate: string): string {
  try {
    const date = parseISO(isoDate);
    return format(date, 'EEE, MMM d \'at\' h:mm a');
  } catch {
    return isoDate;
  }
}

export function formatReminderMessage(reminder: DueReminder): string {
  const isAllDay = !reminder.date.includes('T');
  const dateStr = isAllDay ? formatDate(reminder.date) : formatDateTime(reminder.date);
  const locationStr = reminder.location ? `\n📍 ${reminder.location}` : '';

  switch (reminder.reminderType) {
    case 'week_before':
      return `📅 NEXT WEEK: ${reminder.title}\n${dateStr}${locationStr}\n${reminder.description}`;

    case 'day_before':
      if (reminder.type === 'event') {
        return `📅 TOMORROW: ${reminder.title}\n${dateStr}${locationStr}\n${reminder.description}`;
      }
      return `✅ DUE TOMORROW: ${reminder.title}\n${dateStr}\n${reminder.description}`;

    case 'morning_of':
      return `📅 TODAY: ${reminder.title}\n${dateStr}${locationStr}\n${reminder.description}`;

    case 'deadline_approaching':
      return `⚠️ DEADLINE IN 2 DAYS: ${reminder.title}\n${dateStr}\n${reminder.description}`;

    case 'deadline_today':
      return `🔴 DUE TODAY: ${reminder.title}\n${dateStr}\n${reminder.description}`;

    default:
      return `📋 Reminder: ${reminder.title}\n${dateStr}\n${reminder.description}`;
  }
}
