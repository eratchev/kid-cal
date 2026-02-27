# Design: Reminder Calculation Refactor

## Problem

`getDueReminders()` in `src/state/manager.ts` contains two nearly-identical blocks — one for events, one for action items — each with the same `daysUntil` formula and the same "iterate checks → filter sent → push" loop. If a bug is found in the boundary conditions, it must be fixed in both places.

## Approach: Extract `pushDueReminders()` private helper

Add a private method that handles the shared inner loop:

```typescript
private pushDueReminders(
  into: DueReminder[],
  daysUntil: number,
  checks: { type: ReminderType; condition: boolean }[],
  eventId: number | null,
  actionItemId: number | null,
  base: Omit<DueReminder, 'reminderType'>,
): void {
  for (const check of checks) {
    if (check.condition && !this.isReminderSent(eventId, actionItemId, check.type)) {
      into.push({ ...base, reminderType: check.type });
    }
  }
}
```

Also extract the repeated `daysUntil` formula into a module-level function:

```typescript
function calcDaysUntil(target: Date, now: Date): number {
  return Math.floor((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
```

The two loops in `getDueReminders()` then reduce to: compute `daysUntil`, define item-specific `checks`, call `pushDueReminders()`.

## Files Changed

- `src/state/manager.ts` — add helpers, simplify `getDueReminders()`

## Testing

Existing tests in `tests/state/manager.test.ts` cover the reminder logic; no new tests needed. All 123 tests must pass after the change.
