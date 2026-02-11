import { createHash } from 'crypto';
import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';
import { getCalendarClient } from './auth.js';
import type { ExtractedEvent, ExtractedActionItem } from '../types.js';

const logger = getLogger();

function emailSourceLine(subject: string): string {
  return `From Yahoo Mail: "${subject}"`;
}

/**
 * Generate a deterministic iCalUID from source data for idempotent calendar event creation.
 */
function generateICalUID(prefix: string, sourceEmailId: string, title: string): string {
  const hash = createHash('sha256')
    .update(`${prefix}:${sourceEmailId}:${title}`)
    .digest('hex')
    .substring(0, 24);
  return `${prefix}-${hash}@kid-cal`;
}

/**
 * Find an existing event by iCalUID, including trashed events.
 * If found in trash, update it to restore it with new data.
 */
async function findOrRestoreEvent(
  iCalUID: string,
  requestBody: Record<string, unknown>,
): Promise<string | null> {
  const config = getConfig();
  const calendar = getCalendarClient();

  const existing = await calendar.events.list({
    calendarId: config.GOOGLE_CALENDAR_ID,
    iCalUID,
    showDeleted: true,
  });

  if (!existing.data.items || existing.data.items.length === 0) {
    return null;
  }

  const existingEvent = existing.data.items[0]!;
  const existingId = existingEvent.id!;

  if (existingEvent.status === 'cancelled') {
    // Restore trashed event by updating it with new data
    logger.info({ iCalUID, calendarEventId: existingId }, 'Restoring trashed calendar event');
    await calendar.events.update({
      calendarId: config.GOOGLE_CALENDAR_ID,
      eventId: existingId,
      requestBody: { ...requestBody, status: 'confirmed' } as Parameters<typeof calendar.events.update>[0] extends { requestBody?: infer R } ? R : never,
    });
    return existingId;
  }

  logger.info({ iCalUID, calendarEventId: existingId }, 'Calendar event already exists');
  return existingId;
}

export async function createCalendarEvent(event: ExtractedEvent): Promise<string> {
  const config = getConfig();
  const calendar = getCalendarClient();
  const iCalUID = generateICalUID('evt', event.sourceEmailId, event.title);

  const eventBody: Record<string, unknown> = {
    summary: event.title,
    description: `${event.description}\n\n${emailSourceLine(event.sourceEmailSubject)}`,
    location: event.location ?? undefined,
    iCalUID,
  };

  if (event.allDay) {
    const dateStr = event.startDate.split('T')[0];
    eventBody.start = { date: dateStr };
    if (event.endDate) {
      eventBody.end = { date: event.endDate.split('T')[0] };
    } else {
      const start = new Date(dateStr!);
      start.setDate(start.getDate() + 1);
      eventBody.end = { date: start.toISOString().split('T')[0] };
    }
  } else {
    eventBody.start = { dateTime: event.startDate, timeZone: config.TIMEZONE };
    if (event.endDate) {
      eventBody.end = { dateTime: event.endDate, timeZone: config.TIMEZONE };
    } else {
      const start = new Date(event.startDate);
      start.setHours(start.getHours() + 1);
      eventBody.end = { dateTime: start.toISOString(), timeZone: config.TIMEZONE };
    }
  }

  // Check for existing (including trashed) event
  const existingId = await findOrRestoreEvent(iCalUID, eventBody);
  if (existingId) return existingId;

  const result = await calendar.events.insert({
    calendarId: config.GOOGLE_CALENDAR_ID,
    requestBody: eventBody as Parameters<typeof calendar.events.insert>[0] extends { requestBody?: infer R } ? R : never,
  });

  const calendarEventId = result.data.id;
  if (!calendarEventId) {
    throw new Error(`Google Calendar API returned no event ID for "${event.title}"`);
  }
  logger.info(
    { iCalUID, calendarEventId, title: event.title },
    'Created calendar event',
  );

  return calendarEventId;
}

export async function createActionItemReminder(item: ExtractedActionItem): Promise<string | null> {
  if (!item.deadline) {
    logger.debug({ title: item.title }, 'Skipping action item without deadline');
    return null;
  }

  const config = getConfig();
  const calendar = getCalendarClient();
  const iCalUID = generateICalUID('act', item.sourceEmailId, item.title);

  const dateStr = item.deadline.split('T')[0];
  const endDate = new Date(dateStr!);
  endDate.setDate(endDate.getDate() + 1);

  const priorityEmoji = item.priority === 'high' ? '🔴' : item.priority === 'medium' ? '🟡' : '🟢';

  const requestBody = {
    summary: `${priorityEmoji} TODO: ${item.title}`,
    description: `${item.description}\n\nPriority: ${item.priority}\n${emailSourceLine(item.sourceEmailSubject)}`,
    start: { date: dateStr },
    end: { date: endDate.toISOString().split('T')[0] },
    iCalUID,
  };

  // Check for existing (including trashed) event
  const existingId = await findOrRestoreEvent(iCalUID, requestBody);
  if (existingId) return existingId;

  const result = await calendar.events.insert({
    calendarId: config.GOOGLE_CALENDAR_ID,
    requestBody,
  });

  const calendarEventId = result.data.id;
  if (!calendarEventId) {
    throw new Error(`Google Calendar API returned no event ID for action item "${item.title}"`);
  }
  logger.info(
    { iCalUID, calendarEventId, title: item.title },
    'Created action item calendar event',
  );

  return calendarEventId;
}
