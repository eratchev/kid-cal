# Design: Reduce Reminder Alert Frequency

**Date:** 2026-03-23
**Status:** Approved

## Overview

Reduce alerts per item from up to 4 (events) or 3 (action items) to the minimum useful set: morning-of + 15-min heads-up for events, due-today only for action items.

## Current vs Target

| Type | Current | Target |
|---|---|---|
| Events | `week_before`, `day_before`, `morning_of`, `fifteen_min_before` | `morning_of`, `fifteen_min_before` |
| Action items | `deadline_approaching`, `day_before`, `deadline_today` | `deadline_today` |

## Changes

### `src/state/manager.ts` — `getDueReminders`

**Events loop (day-based batch only — `fifteen_min_before` is a separate pass and is untouched):**
Remove `week_before` and `day_before` conditions. Keep only `morning_of`:

```ts
this.pushDueReminders(reminders, [
  { type: 'morning_of', condition: days <= 0 && days > -1 },
], event.id, null, { ... });
```

Shrink the lookahead from 8 days to 1: `getUpcomingEvents(1)`.

Update the stale comment above the call from:
```ts
// Get events within the next 8 days (covers week_before + buffer)
```
to:
```ts
// Get events within the next day (morning_of only)
```

**Action items loop:** Remove `deadline_approaching` and `day_before` conditions. Keep only `deadline_today`:

```ts
this.pushDueReminders(reminders, [
  { type: 'deadline_today', condition: days <= 0 && days > -1 },
], null, item.id, { ... });
```

Shrink the lookahead from 3 days to 1: `getUpcomingActionItems(1)`.

Update the stale comment above the call from:
```ts
// Get action items within the next 3 days (covers deadline_approaching + buffer)
```
to:
```ts
// Get action items within the next day (deadline_today only)
```

The `fifteen_min_before` pass is unchanged.

### No other changes

- `ReminderType` union in `src/types.ts`: unchanged (unused values are harmless)
- `src/reminders/templates.ts`: unchanged
- Database schema: unchanged
- Existing `sent_reminders` rows for removed types: harmless (no new rows will be written)

## Tests

In `tests/state/manager.test.ts`, inside the `getDueReminders` describe block:

- **Replace** the existing `day_before` event test with a `morning_of` test (same-day event, confirms `morning_of` fires and the reminder fields — title, date, location — are correctly propagated)
- **Replace** the existing `day_before` / `deadline_approaching` action item test with a `deadline_today` test (same-day deadline, confirms `deadline_today` fires)
- **Add** a test confirming `week_before` no longer fires for an event 7 days away
- **Add** a test confirming `deadline_approaching` no longer fires for an action item 2 days away

Do **not** touch the `isReminderSent` / `saveReminder` tests — those use `week_before` and `day_before` directly to test DB persistence, not reminder generation, and remain valid since those values are still in the `ReminderType` union.

## Files Changed

| File | Change |
|---|---|
| `src/state/manager.ts` | Remove 4 conditions from `getDueReminders`; shrink lookahead windows |
| `tests/state/manager.test.ts` | Remove tests for dropped types; add/verify tests for kept types |
