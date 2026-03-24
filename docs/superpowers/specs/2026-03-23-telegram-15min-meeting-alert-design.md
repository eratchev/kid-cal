# Design: Telegram 15-Minute Pre-Meeting Alert

**Date:** 2026-03-23
**Status:** Approved

## Overview

Send a Telegram notification 15 minutes before a timed calendar event starts. Uses the existing polling loop, `sent_reminders` dedup, and Telegram infrastructure. Fires at any time of day (not gated to the morning window).

## Scope

- Applies to **timed events only** (`all_day = 0` in SQL; `event.all_day === 0` in TypeScript — note `StoredEvent.all_day` is `number`, not boolean)
- Does **not** apply to all-day events or action item deadlines
- Fires even if the daemon was briefly offline (catch-up window: up to 30 min after start)
- The "STARTING SOON" message may fire for a meeting that has already begun (up to 30 min ago) — this is intentional

## Data Model

Add `'fifteen_min_before'` to the `ReminderType` union in `types.ts`:

```ts
export type ReminderType =
  | 'week_before'
  | 'day_before'
  | 'morning_of'
  | 'deadline_approaching'
  | 'deadline_today'
  | 'fifteen_min_before';
```

No database schema changes required. The `sent_reminders` table stores `reminder_type` as a string and already handles any value in the union.

## Reminder Detection (`StateManager.getDueReminders`)

### Why a new query helper is needed

The existing `getUpcomingEvents(8)` uses `start_date >= datetime('now')` (UTC, space-separated). Stored `start_date` values are local-time ISO 8601 with `T` separator (e.g. `2026-03-23T09:00:00`). The `T` (ASCII 84) > space (ASCII 32) quirk makes same-date stored values pass the lower bound only when `datetime('now')` has the same date prefix — which breaks after midnight UTC (typically 4–8pm local in US timezones). This is reliable for 8-day lookahead but not for a ±30 min window spanning evening hours.

The correct approach is a new helper that uses `strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ...)`, producing T-separator local-time comparison values that match the stored format:

```ts
private getEventsInMinuteWindow(fromMinutes: number, toMinutes: number): StoredEvent[] {
  return this.db.prepare(`
    SELECT * FROM events
    WHERE all_day = 0
      AND start_date >= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ? || ' minutes')
      AND start_date <= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ? || ' minutes')
    ORDER BY start_date ASC
  `).all(fromMinutes, toMinutes) as StoredEvent[];
}
```

Parameters are signed minute offsets (e.g. `-30` and `+20`). SQLite's `strftime` with `localtime` uses the system's local timezone, which must match `config.TIMEZONE`. For this project (a home daemon in a US timezone), these are always the same.

Verified correct: `strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', '-30 minutes')` and `strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', '+20 minutes')` produce T-separator strings that compare correctly against stored event dates (confirmed in SQLite).

### Detection logic in `getDueReminders`

The `fifteen_min_before` check runs as a **separate pass** after the existing event loop:

```ts
// Existing event loop (unchanged):
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

// New: fifteen_min_before pass
const nearEvents = this.getEventsInMinuteWindow(-30, 20);
for (const event of nearEvents) {
  const minutesUntil = (new Date(event.start_date).getTime() - now.getTime()) / 60_000;
  this.pushDueReminders(reminders, [
    { type: 'fifteen_min_before', condition: minutesUntil >= -30 && minutesUntil <= 20 },
  ], event.id, null, {
    type: 'event',
    itemId: event.id,
    title: event.title,
    description: event.description,
    date: event.start_date,
    location: event.location,
  });
}
```

**Window rationale:**
- `minutesUntil <= 20`: absorbs 5-min poll jitter — the first poll that sees the event within ~15 min triggers the alert
- `minutesUntil >= -30`: catch-up window for daemon downtime — fires up to 30 min after start, then stops
- Both bounds are inclusive (closed interval)
- `minutesUntil` uses JavaScript `Date.getTime()` arithmetic on both sides, correctly parsing unzoned ISO strings as local time

**Overlap with existing checks:** A timed event starting in 10 minutes may appear in both `getUpcomingEvents(8)` (producing `morning_of`) and `getEventsInMinuteWindow(-30, 20)` (producing `fifteen_min_before`). This is intentional — different reminder types, deduped independently in `sent_reminders`.

## Scheduler Changes (`scheduler.ts`)

The current `checkAndSendReminders` returns early before calling `getDueReminders` when outside the morning window:

```ts
if (currentHour < config.MORNING_REMINDER_HOUR || currentHour >= windowEnd) {
  logger.debug({ ... }, 'Outside reminder window, skipping');
  return 0;
}
```

This early return must be removed. The new control flow calls `getDueReminders` unconditionally and splits the results:

```ts
const dueReminders = stateManager.getDueReminders(now, config.TIMEZONE);

const preEventReminders = dueReminders.filter(r => r.reminderType === 'fifteen_min_before');
const morningReminders  = dueReminders.filter(r => r.reminderType !== 'fifteen_min_before');

// Always send pre-event alerts (any time of day)
let sentCount = 0;
for (const reminder of preEventReminders) {
  // ... send + saveReminder + sentCount++ ...
}

// Morning-window reminders only during configured window
if (currentHour >= config.MORNING_REMINDER_HOUR && currentHour < windowEnd) {
  for (const reminder of morningReminders) {
    // ... send + saveReminder + sentCount++ ...
  }
} else if (morningReminders.length > 0) {
  logger.debug({ count: morningReminders.length }, 'Outside morning window, skipping morning reminders');
}

return sentCount;
```

The `'Outside reminder window, skipping'` log is replaced by the more specific `'Outside morning window, skipping morning reminders'` (only logged when morning reminders exist, to avoid noise). `sentCount` is returned as before; it will be 0 when only morning reminders are due and outside the morning window.

**Impact on existing scheduler test:** The existing assertion `expect(sm.getDueReminders).not.toHaveBeenCalled()` when outside the morning window must change — `getDueReminders` is now always called.

## Message Template (`templates.ts`)

Add a `case 'fifteen_min_before':` branch to the `switch` statement in `formatReminderMessage`:

```ts
case 'fifteen_min_before':
  return `🔔 STARTING SOON: ${reminder.title}\n${dateStr}${locationStr}\n${reminder.description}`;
```

Where `dateStr` uses `formatDateTime` (timed events always have a time component) and `locationStr` follows the existing pattern (`reminder.location ? \`\n📍 ${reminder.location}\` : ''`).

## Implementation Notes

1. **Scheduler split predicate:** The scheduler splits reminders by `r.reminderType === 'fifteen_min_before'`, not by `r.type === 'event'`. This is critical — using `type` would incorrectly gate all event reminders.

2. **Test isolation for SQL window queries:** `getEventsInMinuteWindow` calls `strftime('now', 'localtime', ...)` at query time, so tests must insert `start_date` values relative to `Date.now()` (e.g. `new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 19)`), not fixed strings. The existing `getDueReminders` tests mock away the DB query level, but the new `fifteen_min_before` tests exercise the SQL predicate directly and require live time-relative values.

## Error Handling

No changes to error handling. Failures to send are already caught and logged per-reminder in the existing scheduler loop.

## Tests

### `getDueReminders` (StateManager)

| Scenario | Expected |
|---|---|
| `all_day=0`, starts in 10 min | fires `fifteen_min_before` |
| `all_day=0`, starts in exactly 20 min | fires (closed upper bound) |
| `all_day=0`, starts in 21 min | does NOT fire |
| `all_day=0`, started exactly 30 min ago | fires (closed lower bound) |
| `all_day=0`, started 31 min ago | does NOT fire |
| `all_day=0`, started 15 min ago (within catch-up) | fires |
| `all_day=1` | does NOT fire (`all_day = 0` guard in SQL) |
| Already sent (`isReminderSent` returns true) | does NOT fire |
| Timed event in 10 min: both `morning_of` and `fifteen_min_before` | both returned |

### `formatReminderMessage` (templates)

| Scenario | Expected |
|---|---|
| `fifteen_min_before` with location | `🔔 STARTING SOON:` prefix, datetime, location line present |
| `fifteen_min_before` without location | no location line |

### `checkAndSendReminders` (scheduler)

| Scenario | Expected |
|---|---|
| Called at 3pm (outside morning window), timed event in 10 min | `fifteen_min_before` fires, returns ≥ 1 |
| Called at 3pm, only `morning_of` due | does NOT send, returns 0 |
| Called at 9am (inside morning window), both `morning_of` and `fifteen_min_before` due | both fire |
| Called at midnight, `fifteen_min_before` due | fires |
| Called outside morning window, no upcoming timed events | `getDueReminders` IS called, returns 0 (updated from existing test) |

## Files Changed

| File | Change |
|---|---|
| `src/types.ts` | Add `'fifteen_min_before'` to `ReminderType` |
| `src/state/manager.ts` | Add `getEventsInMinuteWindow` helper + `fifteen_min_before` pass in `getDueReminders` |
| `src/reminders/scheduler.ts` | Remove early-return guard; split pre-event vs morning-window reminders |
| `src/reminders/templates.ts` | Add `case 'fifteen_min_before':` to `formatReminderMessage` switch |
| `tests/state/manager.test.ts` | New test cases (including boundary and overlap tests) |
| `tests/reminders/templates.test.ts` | New test cases |
| `tests/reminders/scheduler.test.ts` | New test cases + update existing outside-window assertion |
