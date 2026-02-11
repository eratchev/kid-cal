import { toZonedTime } from 'date-fns-tz';
import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';
import { StateManager } from '../state/manager.js';
import { sendSMS } from './twilio.js';
import { formatReminderMessage } from './templates.js';

const logger = getLogger();

export async function checkAndSendReminders(stateManager: StateManager): Promise<number> {
  const config = getConfig();
  const now = new Date();
  const zonedNow = toZonedTime(now, config.TIMEZONE);
  const currentHour = zonedNow.getHours();

  // Send reminders from the configured morning hour until noon (catch-up window).
  // This ensures reminders still send if the daemon was offline at exactly MORNING_REMINDER_HOUR.
  const windowEnd = config.MORNING_REMINDER_HOUR + 5; // e.g., 7am–12pm
  if (currentHour < config.MORNING_REMINDER_HOUR || currentHour >= windowEnd) {
    logger.debug(
      { currentHour, morningHour: config.MORNING_REMINDER_HOUR, windowEnd, timezone: config.TIMEZONE },
      'Outside reminder window, skipping',
    );
    return 0;
  }

  const dueReminders = stateManager.getDueReminders(now, config.TIMEZONE);

  if (dueReminders.length === 0) {
    logger.debug('No due reminders');
    return 0;
  }

  logger.info({ count: dueReminders.length }, 'Found due reminders');

  let sentCount = 0;
  for (const reminder of dueReminders) {
    try {
      const message = formatReminderMessage(reminder);
      const sid = await sendSMS(message);

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
