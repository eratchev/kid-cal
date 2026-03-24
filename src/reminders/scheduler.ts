import { toZonedTime } from 'date-fns-tz';
import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';
import { StateManager } from '../state/manager.js';
import { sendNotification } from './telegram.js';
import { formatReminderMessage } from './templates.js';

const logger = getLogger();

export async function checkAndSendReminders(stateManager: StateManager): Promise<number> {
  const config = getConfig();
  const now = new Date();
  const zonedNow = toZonedTime(now, config.TIMEZONE);
  const currentHour = zonedNow.getHours();
  const windowEnd = config.MORNING_REMINDER_HOUR + 5; // e.g., 7am–12pm

  const dueReminders = stateManager.getDueReminders(now, config.TIMEZONE);

  if (dueReminders.length === 0) {
    logger.debug('No due reminders');
    return 0;
  }

  // fifteen_min_before fires any time of day; all other types are morning-window only
  const preEventReminders = dueReminders.filter(r => r.reminderType === 'fifteen_min_before');
  const morningReminders  = dueReminders.filter(r => r.reminderType !== 'fifteen_min_before');

  const withinMorningWindow =
    currentHour >= config.MORNING_REMINDER_HOUR && currentHour < windowEnd;

  if (!withinMorningWindow && morningReminders.length > 0) {
    logger.debug(
      { currentHour, morningHour: config.MORNING_REMINDER_HOUR, windowEnd, count: morningReminders.length },
      'Outside morning window, skipping morning reminders',
    );
  }

  const remindersToSend = withinMorningWindow
    ? [...preEventReminders, ...morningReminders]
    : preEventReminders;

  if (remindersToSend.length === 0) {
    return 0;
  }

  logger.info({ count: remindersToSend.length }, 'Found due reminders');

  let sentCount = 0;
  for (const reminder of remindersToSend) {
    try {
      const message = formatReminderMessage(reminder);
      const sid = await sendNotification(message);

      const eventId = reminder.type === 'event' ? reminder.itemId : null;
      const actionItemId = reminder.type === 'action_item' ? reminder.itemId : null;

      stateManager.saveReminder(eventId, actionItemId, reminder.reminderType, sid);
      sentCount++;

      logger.info(
        { reminderType: reminder.reminderType, title: reminder.title, sid },
        'Reminder sent',
      );
    } catch (error) {
      logger.error(
        { error, reminderType: reminder.reminderType, title: reminder.title },
        'Failed to send reminder',
      );
    }
  }

  return sentCount;
}
