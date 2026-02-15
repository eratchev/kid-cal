import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    TIMEZONE: 'America/New_York',
    MORNING_REMINDER_HOUR: 7,
    LOG_LEVEL: 'error',
  }),
}));
vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

const mockSendNotification = vi.fn();
vi.mock('../../src/reminders/telegram.js', () => ({
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

const mockFormatReminderMessage = vi.fn().mockReturnValue('Reminder text');
vi.mock('../../src/reminders/templates.js', () => ({
  formatReminderMessage: (...args: unknown[]) => mockFormatReminderMessage(...args),
}));

// Mock date-fns-tz to control the zoned hour
const mockToZonedTime = vi.fn();
vi.mock('date-fns-tz', () => ({
  toZonedTime: (...args: unknown[]) => mockToZonedTime(...args),
}));

import { checkAndSendReminders } from '../../src/reminders/scheduler.js';
import type { StateManager } from '../../src/state/manager.js';
import type { DueReminder } from '../../src/types.js';

function makeStateManager(dueReminders: DueReminder[] = []): StateManager {
  return {
    getDueReminders: vi.fn().mockReturnValue(dueReminders),
    saveReminder: vi.fn(),
  } as unknown as StateManager;
}

describe('checkAndSendReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when outside reminder window (too early)', async () => {
    mockToZonedTime.mockReturnValue({ getHours: () => 5 }); // 5am, before 7am window

    const sm = makeStateManager();
    const count = await checkAndSendReminders(sm);

    expect(count).toBe(0);
    expect(sm.getDueReminders).not.toHaveBeenCalled();
  });

  it('returns 0 when outside reminder window (too late)', async () => {
    mockToZonedTime.mockReturnValue({ getHours: () => 13 }); // 1pm, after 12pm window

    const sm = makeStateManager();
    const count = await checkAndSendReminders(sm);

    expect(count).toBe(0);
  });

  it('sends reminders when inside window', async () => {
    mockToZonedTime.mockReturnValue({ getHours: () => 8 }); // 8am, inside 7-12 window
    mockSendNotification.mockResolvedValue('SM123');

    const dueReminders: DueReminder[] = [
      {
        type: 'event',
        reminderType: 'day_before',
        itemId: 1,
        title: 'Field Trip',
        description: 'Zoo',
        date: '2025-04-15',
        location: null,
      },
    ];

    const sm = makeStateManager(dueReminders);
    const count = await checkAndSendReminders(sm);

    expect(count).toBe(1);
    expect(mockSendNotification).toHaveBeenCalledWith('Reminder text');
    expect(sm.saveReminder).toHaveBeenCalledWith(1, null, 'day_before', 'SM123');
  });

  it('handles SMS failure gracefully (continues with remaining)', async () => {
    mockToZonedTime.mockReturnValue({ getHours: () => 9 });
    mockSendNotification
      .mockRejectedValueOnce(new Error('Twilio error'))
      .mockResolvedValueOnce('SM456');

    const dueReminders: DueReminder[] = [
      {
        type: 'event',
        reminderType: 'day_before',
        itemId: 1,
        title: 'Event 1',
        description: '',
        date: '2025-04-15',
        location: null,
      },
      {
        type: 'action_item',
        reminderType: 'deadline_today',
        itemId: 2,
        title: 'Action 1',
        description: '',
        date: '2025-04-15',
        location: null,
      },
    ];

    const sm = makeStateManager(dueReminders);
    const count = await checkAndSendReminders(sm);

    // First failed, second succeeded
    expect(count).toBe(1);
    expect(mockSendNotification).toHaveBeenCalledTimes(2);
  });

  it('saves action_item reminder with correct IDs', async () => {
    mockToZonedTime.mockReturnValue({ getHours: () => 7 });
    mockSendNotification.mockResolvedValue('SM789');

    const dueReminders: DueReminder[] = [
      {
        type: 'action_item',
        reminderType: 'deadline_approaching',
        itemId: 5,
        title: 'Permission Slip',
        description: 'Return it',
        date: '2025-04-12',
        location: null,
      },
    ];

    const sm = makeStateManager(dueReminders);
    await checkAndSendReminders(sm);

    expect(sm.saveReminder).toHaveBeenCalledWith(null, 5, 'deadline_approaching', 'SM789');
  });
});
