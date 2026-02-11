import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    GOOGLE_CALENDAR_ID: 'test-calendar-id',
    TIMEZONE: 'America/New_York',
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

const mockEventsList = vi.fn();
const mockEventsInsert = vi.fn();

vi.mock('../../src/calendar/auth.js', () => ({
  getCalendarClient: () => ({
    events: {
      list: mockEventsList,
      insert: mockEventsInsert,
      update: vi.fn(),
    },
  }),
}));

import { createCalendarEvent, createActionItemReminder } from '../../src/calendar/service.js';
import type { ExtractedEvent, ExtractedActionItem } from '../../src/types.js';

function makeEvent(overrides: Partial<ExtractedEvent> = {}): ExtractedEvent {
  return {
    title: 'Field Trip',
    description: 'Zoo visit',
    startDate: '2025-04-15T09:00:00',
    endDate: '2025-04-15T14:00:00',
    allDay: false,
    location: 'City Zoo',
    sourceEmailId: 'email-1',
    sourceEmailSubject: 'Field Trip Permission',
    ...overrides,
  };
}

function makeActionItem(overrides: Partial<ExtractedActionItem> = {}): ExtractedActionItem {
  return {
    title: 'Permission Slip',
    description: 'Sign and return',
    deadline: '2025-04-10',
    priority: 'high',
    sourceEmailId: 'email-1',
    sourceEmailSubject: 'Permission Slip Due',
    ...overrides,
  };
}

describe('createCalendarEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts new event and returns id', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    mockEventsInsert.mockResolvedValue({ data: { id: 'cal-event-123' } });

    const id = await createCalendarEvent(makeEvent());
    expect(id).toBe('cal-event-123');
    expect(mockEventsInsert).toHaveBeenCalled();
  });

  it('returns existing event id when found by iCalUID', async () => {
    mockEventsList.mockResolvedValue({
      data: { items: [{ id: 'existing-id' }] },
    });

    const id = await createCalendarEvent(makeEvent());
    expect(id).toBe('existing-id');
    expect(mockEventsInsert).not.toHaveBeenCalled();
  });

  it('uses date (not dateTime) for all-day events', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    mockEventsInsert.mockResolvedValue({ data: { id: 'allday-id' } });

    await createCalendarEvent(makeEvent({ allDay: true, startDate: '2025-04-15T00:00:00', endDate: null }));

    const insertCall = mockEventsInsert.mock.calls[0][0];
    expect(insertCall.requestBody.start).toEqual({ date: '2025-04-15' });
    expect(insertCall.requestBody.end.date).toBeDefined();
    // Should not have dateTime
    expect(insertCall.requestBody.start.dateTime).toBeUndefined();
  });

  it('all-day event with explicit end date uses end date', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    mockEventsInsert.mockResolvedValue({ data: { id: 'allday-end-id' } });

    await createCalendarEvent(makeEvent({
      allDay: true,
      startDate: '2025-04-15T00:00:00',
      endDate: '2025-04-17T00:00:00',
    }));

    const insertCall = mockEventsInsert.mock.calls[0][0];
    expect(insertCall.requestBody.start).toEqual({ date: '2025-04-15' });
    expect(insertCall.requestBody.end).toEqual({ date: '2025-04-17' });
  });

  it('timed event without end date defaults to 1 hour', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    mockEventsInsert.mockResolvedValue({ data: { id: 'no-end-id' } });

    await createCalendarEvent(makeEvent({
      allDay: false,
      startDate: '2025-04-15T09:00:00',
      endDate: null,
    }));

    const insertCall = mockEventsInsert.mock.calls[0][0];
    expect(insertCall.requestBody.start.dateTime).toBe('2025-04-15T09:00:00');
    expect(insertCall.requestBody.end.dateTime).toBeDefined();
    // End should be 1 hour after start
    const endDate = new Date(insertCall.requestBody.end.dateTime);
    expect(endDate.getHours()).toBe(new Date('2025-04-15T09:00:00').getHours() + 1);
  });

  it('throws when API returns no id', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    mockEventsInsert.mockResolvedValue({ data: { id: undefined } });

    await expect(createCalendarEvent(makeEvent())).rejects.toThrow('returned no event ID');
  });

  it('generates deterministic iCalUID for same inputs', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    mockEventsInsert.mockResolvedValue({ data: { id: 'id1' } });

    await createCalendarEvent(makeEvent());
    const firstUID = mockEventsList.mock.calls[0][0].iCalUID;

    vi.clearAllMocks();
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    mockEventsInsert.mockResolvedValue({ data: { id: 'id2' } });

    await createCalendarEvent(makeEvent());
    const secondUID = mockEventsList.mock.calls[0][0].iCalUID;

    expect(firstUID).toBe(secondUID);
  });
});

describe('createActionItemReminder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates todo with priority emoji', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    mockEventsInsert.mockResolvedValue({ data: { id: 'action-id' } });

    const id = await createActionItemReminder(makeActionItem({ priority: 'high' }));
    expect(id).toBe('action-id');

    const insertCall = mockEventsInsert.mock.calls[0][0];
    expect(insertCall.requestBody.summary).toContain('🔴');
    expect(insertCall.requestBody.summary).toContain('TODO:');
  });

  it('returns null for no-deadline items', async () => {
    const id = await createActionItemReminder(makeActionItem({ deadline: null }));
    expect(id).toBeNull();
    expect(mockEventsInsert).not.toHaveBeenCalled();
  });

  it('throws when API returns no id', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    mockEventsInsert.mockResolvedValue({ data: { id: undefined } });

    await expect(createActionItemReminder(makeActionItem())).rejects.toThrow('returned no event ID');
  });

  it('returns existing id when action item already exists', async () => {
    mockEventsList.mockResolvedValue({
      data: { items: [{ id: 'existing-action-id' }] },
    });

    const id = await createActionItemReminder(makeActionItem());
    expect(id).toBe('existing-action-id');
    expect(mockEventsInsert).not.toHaveBeenCalled();
  });

  it('uses medium priority emoji', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    mockEventsInsert.mockResolvedValue({ data: { id: 'med-id' } });

    await createActionItemReminder(makeActionItem({ priority: 'medium' }));

    const insertCall = mockEventsInsert.mock.calls[0][0];
    expect(insertCall.requestBody.summary).toContain('🟡');
  });

  it('uses low priority emoji', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    mockEventsInsert.mockResolvedValue({ data: { id: 'low-id' } });

    await createActionItemReminder(makeActionItem({ priority: 'low' }));

    const insertCall = mockEventsInsert.mock.calls[0][0];
    expect(insertCall.requestBody.summary).toContain('🟢');
  });
});
