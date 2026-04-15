import { getConfig } from './config.js';
import { getLogger } from './logger.js';
import { getDatabase, closeDatabase, initializeSchema } from './state/database.js';
import { runMigrations } from './state/migrations.js';
import { StateManager } from './state/manager.js';
import { EmailPoller } from './email/poller.js';
import { parseEmail } from './email/parser.js';
import { isSchoolEmail, isBlockedSubject } from './email/filter.js';
import { extractFromEmail } from './extraction/extractor.js';
import { createCalendarEvent, createActionItemReminder } from './calendar/service.js';
import { checkAndSendReminders } from './reminders/scheduler.js';
import { sendNotification } from './reminders/telegram.js';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = MAX_RETRIES,
): Promise<T> {
  const logger = getLogger();
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = RETRY_BASE_MS * Math.pow(4, attempt); // 1s, 4s, 16s
        logger.warn({ attempt: attempt + 1, maxRetries, delay, label, error }, 'Retrying after failure');
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// Track non-school email message IDs to avoid re-parsing them every cycle
const skippedNonSchoolIds = new Set<string>();

/** Clear the skipped non-school IDs cache (used in tests). */
export function clearSkippedNonSchoolIds(): void {
  skippedNonSchoolIds.clear();
}

export async function processEmails(
  poller: EmailPoller,
  stateManager: StateManager,
): Promise<void> {
  const logger = getLogger();

  // Ensure connected
  if (!poller.isConnected()) {
    await withRetry(() => poller.connect(), 'IMAP connect');
  }

  const rawEmails = await withRetry(() => poller.fetchUnseen(), 'IMAP fetch');

  for (const raw of rawEmails) {
    try {
      // Skip non-school emails we've already seen
      if (skippedNonSchoolIds.has(raw.messageId)) {
        continue;
      }

      // Parse
      const parsed = await parseEmail(raw);

      // Dedup check
      if (stateManager.isProcessed(parsed.messageId)) {
        logger.info({ messageId: parsed.messageId }, 'Email already processed, skipping');
        continue;
      }

      // Filter — skip non-school emails without marking them as read
      if (!isSchoolEmail(parsed)) {
        skippedNonSchoolIds.add(parsed.messageId);
        continue;
      }

      // Filter — skip school emails whose subject matches a blocked keyword
      if (isBlockedSubject(parsed)) {
        logger.info(
          { messageId: parsed.messageId, subject: parsed.subject },
          'Email skipped (blocked subject keyword)',
        );
        skippedNonSchoolIds.add(parsed.messageId);
        continue;
      }

      logger.info(
        { messageId: parsed.messageId, from: parsed.from, subject: parsed.subject },
        'Processing school email',
      );

      // Extract events and action items
      const extraction = await withRetry(
        () => extractFromEmail(parsed),
        'Claude extraction',
      );

      // Save processed email record
      const emailStatus = extraction.extractionFailed ? 'failed' : 'success';
      const emailError = extraction.extractionFailed ? 'Claude extraction returned no parsed output' : null;
      stateManager.saveProcessedEmail({
        messageId: parsed.messageId,
        from: parsed.from,
        subject: parsed.subject,
        processedAt: new Date().toISOString(),
        status: emailStatus,
        errorMessage: emailError,
        eventCount: extraction.events.length,
        actionItemCount: extraction.actionItems.length,
      });

      if (extraction.extractionFailed) {
        logger.warn(
          { messageId: parsed.messageId, subject: parsed.subject },
          'Extraction failed — email saved as failed',
        );
        try {
          await sendNotification(
            `⚠️ kid-cal: Failed to extract events from "${parsed.subject}" (${parsed.from}). Check logs.`
          );
        } catch {
          // Best effort alert
        }
      }

      // Create calendar events (with cross-email dedup)
      for (const event of extraction.events) {
        try {
          const duplicate = stateManager.findDuplicateEvent(event.title, event.startDate);
          if (duplicate) {
            logger.info(
              { title: event.title, startDate: event.startDate, existingEventId: duplicate.id },
              'Skipping duplicate event (already exists from another email)',
            );
            continue;
          }

          const storedEvent = stateManager.saveEvent(event);
          try {
            const calendarId = await withRetry(
              () => createCalendarEvent(event),
              'Google Calendar create event',
            );
            stateManager.updateEventCalendarId(storedEvent.id, calendarId);
          } catch (calError) {
            logger.error({ error: calError, title: event.title, eventId: storedEvent.id },
              'Failed to create calendar event (DB record saved without calendar ID)');
          }
        } catch (error) {
          logger.error({ error, title: event.title }, 'Failed to save event');
        }
      }

      // Create action item reminders on calendar (with cross-email dedup)
      for (const item of extraction.actionItems) {
        try {
          const duplicate = stateManager.findDuplicateActionItem(item.title, item.deadline);
          if (duplicate) {
            logger.info(
              { title: item.title, deadline: item.deadline, existingActionItemId: duplicate.id },
              'Skipping duplicate action item (already exists from another email)',
            );
            continue;
          }

          const storedItem = stateManager.saveActionItem(item);
          try {
            const calendarId = await withRetry(
              () => createActionItemReminder(item),
              'Google Calendar create action item',
            );
            if (calendarId) {
              stateManager.updateActionItemCalendarId(storedItem.id, calendarId);
            }
          } catch (calError) {
            logger.error({ error: calError, title: item.title, actionItemId: storedItem.id },
              'Failed to create action item calendar event (DB record saved without calendar ID)');
          }
        } catch (error) {
          logger.error({ error, title: item.title }, 'Failed to save action item');
        }
      }

      logger.info(
        {
          messageId: parsed.messageId,
          events: extraction.events.length,
          actionItems: extraction.actionItems.length,
          summary: extraction.summary,
        },
        'Email processed successfully',
      );
    } catch (error) {
      logger.error({ error, uid: raw.uid, messageId: raw.messageId }, 'Failed to process email');

      // Record failure
      try {
        stateManager.saveProcessedEmail({
          messageId: raw.messageId,
          from: raw.envelope.from[0]?.address ?? 'unknown',
          subject: raw.envelope.subject,
          processedAt: new Date().toISOString(),
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          eventCount: 0,
          actionItemCount: 0,
        });
      } catch {
        // Don't fail on failure recording
      }

    }
  }
}

export async function retryOrphanedCalendarEvents(stateManager: StateManager): Promise<void> {
  const logger = getLogger();

  const orphanedEvents = stateManager.getOrphanedEvents();
  for (const event of orphanedEvents) {
    try {
      const calendarId = await withRetry(
        () => createCalendarEvent({
          title: event.title,
          description: event.description,
          startDate: event.start_date,
          endDate: event.end_date,
          allDay: event.all_day === 1,
          location: event.location,
          sourceEmailId: event.email_message_id,
          sourceEmailSubject: stateManager.getEmailSubject(event.email_message_id),
        }),
        'Google Calendar retry event',
      );
      stateManager.updateEventCalendarId(event.id, calendarId);
      logger.info({ eventId: event.id, title: event.title }, 'Retry: created calendar event');
    } catch (error) {
      logger.warn({ error, eventId: event.id, title: event.title }, 'Retry: still failed to create calendar event');
    }
  }

  const orphanedItems = stateManager.getOrphanedActionItems();
  for (const item of orphanedItems) {
    try {
      const calendarId = await withRetry(
        () => createActionItemReminder({
          title: item.title,
          description: item.description,
          deadline: item.deadline,
          priority: item.priority,
          sourceEmailId: item.email_message_id,
          sourceEmailSubject: stateManager.getEmailSubject(item.email_message_id),
        }),
        'Google Calendar retry action item',
      );
      if (calendarId) {
        stateManager.updateActionItemCalendarId(item.id, calendarId);
        logger.info({ actionItemId: item.id, title: item.title }, 'Retry: created action item calendar event');
      }
    } catch (error) {
      logger.warn({ error, actionItemId: item.id, title: item.title }, 'Retry: still failed to create action item calendar event');
    }
  }
}

async function main(): Promise<void> {
  const config = getConfig();
  const logger = getLogger();

  logger.info('kid-cal starting up');

  // Initialize database
  const db = getDatabase();
  initializeSchema(db);
  runMigrations(db);
  const stateManager = new StateManager(db);

  logger.info('Database initialized');

  // Initialize email poller
  const poller = new EmailPoller();

  let consecutiveImapFailures = 0;
  let running = true;

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    running = false;
    await poller.disconnect();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Main polling loop
  while (running) {
    // Process emails
    try {
      await processEmails(poller, stateManager);
      consecutiveImapFailures = 0;
    } catch (error) {
      consecutiveImapFailures++;
      logger.error(
        { error, consecutiveFailures: consecutiveImapFailures },
        'Email processing cycle failed',
      );

      // Alert after 8 consecutive IMAP failures
      if (consecutiveImapFailures >= 8) {
        consecutiveImapFailures = 0;
        try {
          await sendNotification(
            `⚠️ kid-cal: 8 consecutive IMAP failures. Check credentials and connectivity.`
          );
        } catch (alertError) {
          logger.error({ error: alertError }, 'Failed to send IMAP failure alert');
        }
      }

      // Reconnect on next cycle
      try { await poller.disconnect(); } catch { /* ignore */ }
    }

    // Retry orphaned calendar events (missing calendar_event_id)
    try {
      await retryOrphanedCalendarEvents(stateManager);
    } catch (error) {
      logger.error({ error }, 'Orphaned calendar event retry failed');
    }

    // Check and send reminders
    try {
      await checkAndSendReminders(stateManager);
    } catch (error) {
      logger.error({ error }, 'Reminder check failed');
    }

    // Wait for next poll cycle
    if (running) {
      const waitMs = config.POLL_INTERVAL_MINUTES * 60 * 1000;
      logger.debug({ waitMs }, 'Waiting for next poll cycle');
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
