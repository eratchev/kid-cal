# Reminder Calculation Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate duplicated reminder-check logic in `getDueReminders()` by extracting a private helper and a module-level `calcDaysUntil` function.

**Architecture:** Add `calcDaysUntil(target, now)` as a module-level pure function and `pushDueReminders()` as a private method on `StateManager`. Reduce the two parallel loops in `getDueReminders()` to setup code that calls those helpers.

**Tech Stack:** TypeScript, better-sqlite3, vitest

---

### Task 1: Verify baseline tests pass

**Files:**
- (no changes)

**Step 1: Run the existing reminder tests to establish a baseline**

```bash
npm test -- --reporter=verbose tests/state/manager.test.ts
```

Expected: all tests in that file pass.

---

### Task 2: Add `calcDaysUntil` module-level function

**Files:**
- Modify: `src/state/manager.ts` (top of file, before the class)

**Step 1: Add the function above the `StateManager` class**

In `src/state/manager.ts`, insert after the imports and before `export class StateManager`:

```typescript
function calcDaysUntil(target: Date, now: Date): number {
  return Math.floor((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
```

**Step 2: Run tests to confirm nothing broke**

```bash
npm test -- tests/state/manager.test.ts
```

Expected: all tests pass (function is not yet used).

---

### Task 3: Add `pushDueReminders` private method to `StateManager`

**Files:**
- Modify: `src/state/manager.ts` — add private method after `isReminderSent()`

**Step 1: Add the method between `isReminderSent()` and `saveReminder()`**

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

**Step 2: Run tests to confirm nothing broke**

```bash
npm test -- tests/state/manager.test.ts
```

Expected: all tests pass (method is not yet used).

---

### Task 4: Refactor the events loop in `getDueReminders()`

**Files:**
- Modify: `src/state/manager.ts:187-215` (the events loop)

**Step 1: Replace the events loop body**

Replace this block inside `getDueReminders()`:

```typescript
// Get events within the next 8 days (covers week_before + buffer)
const events = this.getUpcomingEvents(8);
for (const event of events) {
  const eventDate = new Date(event.start_date);
  const daysUntil = Math.floor((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  const checks: { type: ReminderType; condition: boolean }[] = [
    { type: 'week_before', condition: daysUntil <= 7 && daysUntil > 1 },
    { type: 'day_before', condition: daysUntil <= 1 && daysUntil > 0 },
    { type: 'morning_of', condition: daysUntil <= 0 && daysUntil > -1 },
  ];

  for (const check of checks) {
    if (check.condition && !this.isReminderSent(event.id, null, check.type)) {
      reminders.push({
        type: 'event',
        reminderType: check.type,
        itemId: event.id,
        title: event.title,
        description: event.description,
        date: event.start_date,
        location: event.location,
      });
    }
  }
}
```

With:

```typescript
// Get events within the next 8 days (covers week_before + buffer)
const events = this.getUpcomingEvents(8);
for (const event of events) {
  const days = calcDaysUntil(new Date(event.start_date), now);
  this.pushDueReminders(reminders, days, [
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
```

**Step 2: Run tests**

```bash
npm test -- tests/state/manager.test.ts
```

Expected: all tests pass.

---

### Task 5: Refactor the action items loop in `getDueReminders()`

**Files:**
- Modify: `src/state/manager.ts:217-243` (the action items loop)

**Step 1: Replace the action items loop body**

Replace this block:

```typescript
// Get action items within the next 3 days (covers deadline_approaching + buffer)
const actionItems = this.getUpcomingActionItems(3);
for (const item of actionItems) {
  if (!item.deadline) continue;
  const deadlineDate = new Date(item.deadline);
  const daysUntil = Math.floor((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  const checks: { type: ReminderType; condition: boolean }[] = [
    { type: 'deadline_approaching', condition: daysUntil <= 2 && daysUntil > 1 },
    { type: 'day_before', condition: daysUntil <= 1 && daysUntil > 0 },
    { type: 'deadline_today', condition: daysUntil <= 0 && daysUntil > -1 },
  ];

  for (const check of checks) {
    if (check.condition && !this.isReminderSent(null, item.id, check.type)) {
      reminders.push({
        type: 'action_item',
        reminderType: check.type,
        itemId: item.id,
        title: item.title,
        description: item.description,
        date: item.deadline,
        location: null,
      });
    }
  }
}
```

With:

```typescript
// Get action items within the next 3 days (covers deadline_approaching + buffer)
const actionItems = this.getUpcomingActionItems(3);
for (const item of actionItems) {
  if (!item.deadline) continue;
  const days = calcDaysUntil(new Date(item.deadline), now);
  this.pushDueReminders(reminders, days, [
    { type: 'deadline_approaching', condition: days <= 2 && days > 1 },
    { type: 'day_before',           condition: days <= 1 && days > 0 },
    { type: 'deadline_today',       condition: days <= 0 && days > -1 },
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

**Step 2: Run full test suite**

```bash
npm test
```

Expected: 123 tests pass.

---

### Task 6: Build and commit

**Step 1: Build**

```bash
npm run build
```

Expected: no errors.

**Step 2: Commit**

```bash
git add src/state/manager.ts
git commit -m "Refactor getDueReminders: extract calcDaysUntil and pushDueReminders helpers"
```
