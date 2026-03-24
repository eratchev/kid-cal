# Reduce Reminder Alerts Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce alerts per item to `morning_of` + `fifteen_min_before` for events, and `deadline_today` only for action items.

**Architecture:** Remove `week_before`, `day_before`, and `deadline_approaching` conditions from `getDueReminders` in `StateManager`, shrink the SQL lookahead windows from 8→1 and 3→1 days, and update the inline comments and tests. No other files change.

**Tech Stack:** TypeScript, SQLite via better-sqlite3, Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-reduce-reminder-alerts-design.md`

---

## Chunk 1: Reduce getDueReminders and update tests

### Task 1: Slim down `getDueReminders` and update tests

**Files:**
- Modify: `src/state/manager.ts`
- Test: `tests/state/manager.test.ts`

**Important context:**

- `calcDaysUntil(target, now)` = `Math.floor((target - now) / 86400000)`. An event 2 hours in the future gives `days = 0`, satisfying `morning_of` (`days <= 0 && days > -1`). ✓
- All test events must store `start_date` / `deadline` as **local-time unzoned ISO strings** (`2026-03-23T17:00:00`, no `Z`, no `+offset`). Use the `toLocalISO` helper below — do NOT use `.toISOString()` which returns UTC and causes SQL window mismatches.
- The `fifteen_min_before` pass (lines 255–273 of `manager.ts`) is completely untouched.
- Do NOT touch the `isReminderSent` / `saveReminder` tests — they use `week_before` and `day_before` as literal type strings to test DB persistence, not reminder generation, and those values remain in the `ReminderType` union.

- [ ] **Step 1: Write the failing tests**

In `tests/state/manager.test.ts`, inside `describe('getDueReminders', ...)`:

**1a. Add `toLocalISO` helper** inside the describe block (after `beforeEach`):

```ts
function toLocalISO(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
```

**1b. Replace** `'returns event reminders based on days until event'` with:

```ts
it('returns morning_of reminder for a same-day timed event', () => {
  const now = new Date();
  // 2 hours from now → calcDaysUntil = Math.floor(2/24) = 0, satisfies morning_of
  const startDate = toLocalISO(new Date(Date.now() + 2 * 60 * 60_000));

  manager.saveEvent({
    title: 'Today Event',
    description: 'Happening today',
    startDate,
    endDate: null,
    allDay: false,
    location: 'School',
    sourceEmailId: 'email-1',
  });

  const reminders = manager.getDueReminders(now, 'America/New_York');

  const r = reminders.find(r => r.reminderType === 'morning_of');
  expect(r).toBeDefined();
  expect(r!.title).toBe('Today Event');
  expect(r!.type).toBe('event');
  expect(r!.location).toBe('School');
});
```

**1c. Replace** `'returns action item reminders based on deadline'` with:

```ts
it('returns deadline_today reminder for a same-day action item deadline', () => {
  const now = new Date();
  const deadline = toLocalISO(new Date(Date.now() + 2 * 60 * 60_000));

  manager.saveActionItem({
    title: 'Return Form',
    description: 'Sign it',
    deadline,
    priority: 'high',
    sourceEmailId: 'email-1',
  });

  const reminders = manager.getDueReminders(now, 'America/New_York');

  const r = reminders.find(r => r.reminderType === 'deadline_today');
  expect(r).toBeDefined();
  expect(r!.title).toBe('Return Form');
  expect(r!.location).toBeNull();
});
```

**1d. Replace** `'does not return already-sent reminders'` with:

```ts
it('does not return already-sent morning_of reminder', () => {
  const now = new Date();
  const startDate = toLocalISO(new Date(Date.now() + 2 * 60 * 60_000));

  const event = manager.saveEvent({
    title: 'Already Reminded',
    description: 'Test',
    startDate,
    endDate: null,
    allDay: false,
    location: null,
    sourceEmailId: 'email-1',
  });

  manager.saveReminder(event.id, null, 'morning_of', 'MSG_old');

  const reminders = manager.getDueReminders(now, 'America/New_York');
  expect(reminders.find(r => r.reminderType === 'morning_of' && r.itemId === event.id)).toBeUndefined();
});
```

**1e. Add** two negative tests (after the existing tests, before the closing `}`):

```ts
it('does NOT fire week_before for an event 7 days away', () => {
  const startDate = toLocalISO(new Date(Date.now() + 7 * 24 * 60 * 60_000));

  manager.saveEvent({
    title: 'Far Event',
    description: '',
    startDate,
    endDate: null,
    allDay: false,
    location: null,
    sourceEmailId: 'email-1',
  });

  const reminders = manager.getDueReminders(new Date(), 'America/New_York');
  expect(reminders.find(r => r.reminderType === 'week_before')).toBeUndefined();
  // Also confirm no other day-based reminder fires for this event
  expect(reminders.find(r => r.reminderType === 'morning_of')).toBeUndefined();
});

it('does NOT fire deadline_approaching for an action item 2 days away', () => {
  const deadline = toLocalISO(new Date(Date.now() + 2 * 24 * 60 * 60_000));

  manager.saveActionItem({
    title: 'Future Task',
    description: '',
    deadline,
    priority: 'low',
    sourceEmailId: 'email-1',
  });

  const reminders = manager.getDueReminders(new Date(), 'America/New_York');
  expect(reminders.find(r => r.reminderType === 'deadline_approaching')).toBeUndefined();
  expect(reminders.find(r => r.reminderType === 'deadline_today')).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to confirm the two negative tests fail**

```bash
npm test -- manager
```

Expected: the two negative tests in 1e FAIL — the current code still emits `week_before` and `deadline_approaching`, so they are unexpectedly found. Tests 1b, 1c, and 1d will already pass (the current code also emits `morning_of` / `deadline_today`), which is fine — their value is as regression guards after the implementation change.

- [ ] **Step 3: Update `src/state/manager.ts`**

**3a.** Change the events loop (lines 218–234) to:

```ts
// Get events within the next day (morning_of only)
const events = this.getUpcomingEvents(1);
for (const event of events) {
  const days = calcDaysUntil(new Date(event.start_date), now);
  this.pushDueReminders(reminders, [
    { type: 'morning_of', condition: days <= 0 && days > -1 },
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

**3b.** Change the action items loop (lines 236–253) to:

```ts
// Get action items within the next day (deadline_today only)
const actionItems = this.getUpcomingActionItems(1);
for (const item of actionItems) {
  if (!item.deadline) continue;
  const days = calcDaysUntil(new Date(item.deadline), now);
  this.pushDueReminders(reminders, [
    { type: 'deadline_today', condition: days <= 0 && days > -1 },
  ], null, item.id, {
    type: 'action_item',
    itemId: item.id,
    title: item.title,
    description: item.description,
    date: item.deadline,
    location: null,
  });
}
```

The `fifteen_min_before` block that follows (lines 255–273) is unchanged.

**3c.** In `tests/state/manager.test.ts`, find the comment in the `'returns both morning_of and fifteen_min_before for a timed event starting in 10 minutes'` test (inside `describe('getDueReminders - fifteen_min_before', ...)`) that reads:

```ts
// This test covers two code paths: getUpcomingEvents(8) produces morning_of,
```

Update it to:

```ts
// This test covers two code paths: getUpcomingEvents(1) produces morning_of,
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- manager
```

Expected: all tests pass including the 5 new/updated ones.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/state/manager.ts tests/state/manager.test.ts
git commit -m "feat: reduce reminders to morning_of and deadline_today only"
```
