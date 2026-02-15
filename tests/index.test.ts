import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    POLL_INTERVAL_MINUTES: 5,
    TIMEZONE: 'America/New_York',
    LOG_LEVEL: 'error',
  }),
}));
vi.mock('../src/logger.js', () => ({
  getLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

// Mock all external services
const mockParseEmail = vi.fn();
vi.mock('../src/email/parser.js', () => ({
  parseEmail: (...args: unknown[]) => mockParseEmail(...args),
}));

const mockIsSchoolEmail = vi.fn();
vi.mock('../src/email/filter.js', () => ({
  isSchoolEmail: (...args: unknown[]) => mockIsSchoolEmail(...args),
}));

const mockExtractFromEmail = vi.fn();
vi.mock('../src/extraction/extractor.js', () => ({
  extractFromEmail: (...args: unknown[]) => mockExtractFromEmail(...args),
}));

const mockCreateCalendarEvent = vi.fn();
const mockCreateActionItemReminder = vi.fn();
vi.mock('../src/calendar/service.js', () => ({
  createCalendarEvent: (...args: unknown[]) => mockCreateCalendarEvent(...args),
  createActionItemReminder: (...args: unknown[]) => mockCreateActionItemReminder(...args),
}));

const mockCheckAndSendReminders = vi.fn();
vi.mock('../src/reminders/scheduler.js', () => ({
  checkAndSendReminders: (...args: unknown[]) => mockCheckAndSendReminders(...args),
}));

const mockSendNotification = vi.fn();
vi.mock('../src/reminders/telegram.js', () => ({
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

vi.mock('../src/state/database.js', () => ({
  getDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  initializeSchema: vi.fn(),
}));
vi.mock('../src/state/migrations.js', () => ({
  runMigrations: vi.fn(),
}));

import { processEmails, withRetry, clearSkippedNonSchoolIds } from '../src/index.js';
import type { EmailPoller } from '../src/email/poller.js';
import type { StateManager } from '../src/state/manager.js';

function makePoller(overrides: Partial<EmailPoller> = {}): EmailPoller {
  return {
    connect: vi.fn(),
    fetchUnseen: vi.fn().mockResolvedValue([]),
    markSeen: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as EmailPoller;
}

function makeStateManager(overrides: Record<string, unknown> = {}): StateManager {
  return {
    isProcessed: vi.fn().mockReturnValue(false),
    saveProcessedEmail: vi.fn(),
    saveEvent: vi.fn().mockReturnValue({ id: 1 }),
    saveActionItem: vi.fn().mockReturnValue({ id: 1 }),
    updateEventCalendarId: vi.fn(),
    updateActionItemCalendarId: vi.fn(),
    findDuplicateEvent: vi.fn().mockReturnValue(null),
    findDuplicateActionItem: vi.fn().mockReturnValue(null),
    ...overrides,
  } as unknown as StateManager;
}

const rawEmail = {
  uid: 1,
  messageId: 'msg-1',
  envelope: {
    from: [{ name: 'Teacher', address: 'teacher@school.org' }],
    subject: 'Field Trip',
    date: new Date('2025-04-01'),
  },
  source: Buffer.from('email source'),
};

const parsedEmail = {
  messageId: 'msg-1',
  from: 'teacher@school.org',
  fromDomain: 'school.org',
  subject: 'Field Trip',
  date: new Date('2025-04-01'),
  textBody: 'Field trip text',
  htmlBody: '',
  cleanText: 'Field trip text',
};

const extraction = {
  events: [
    {
      title: 'Field Trip',
      description: 'Zoo visit',
      startDate: '2025-04-15T09:00:00',
      endDate: null,
      allDay: false,
      location: 'Zoo',
      sourceEmailId: 'msg-1',
      sourceEmailSubject: 'School Newsletter',
    },
  ],
  actionItems: [
    {
      title: 'Permission Slip',
      description: 'Sign and return',
      deadline: '2025-04-10',
      priority: 'high' as const,
      sourceEmailId: 'msg-1',
      sourceEmailSubject: 'School Newsletter',
    },
  ],
  summary: 'Field trip to zoo.',
};

describe('processEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSkippedNonSchoolIds();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('full pipeline: poll → parse → filter → extract → save → calendar', async () => {
    const poller = makePoller({
      fetchUnseen: vi.fn().mockResolvedValue([rawEmail]),
    });
    const sm = makeStateManager();

    mockParseEmail.mockResolvedValue(parsedEmail);
    mockIsSchoolEmail.mockReturnValue(true);
    mockExtractFromEmail.mockResolvedValue(extraction);
    mockCreateCalendarEvent.mockResolvedValue('cal-id-1');
    mockCreateActionItemReminder.mockResolvedValue('cal-id-2');

    await processEmails(poller, sm);

    expect(mockParseEmail).toHaveBeenCalled();
    expect(mockIsSchoolEmail).toHaveBeenCalledWith(parsedEmail);
    expect(mockExtractFromEmail).toHaveBeenCalledWith(parsedEmail);
    expect(sm.saveProcessedEmail).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'msg-1',
      status: 'success',
    }));
    expect(sm.saveEvent).toHaveBeenCalled();
    expect(mockCreateCalendarEvent).toHaveBeenCalled();
    expect(sm.updateEventCalendarId).toHaveBeenCalledWith(1, 'cal-id-1');
    expect(sm.saveActionItem).toHaveBeenCalled();
    expect(mockCreateActionItemReminder).toHaveBeenCalled();
    expect(sm.updateActionItemCalendarId).toHaveBeenCalledWith(1, 'cal-id-2');
    expect(poller.markSeen).not.toHaveBeenCalled();
  });

  it('skips already-processed emails', async () => {
    const poller = makePoller({
      fetchUnseen: vi.fn().mockResolvedValue([rawEmail]),
    });
    const sm = makeStateManager({
      isProcessed: vi.fn().mockReturnValue(true),
    });

    mockParseEmail.mockResolvedValue(parsedEmail);

    await processEmails(poller, sm);

    expect(mockIsSchoolEmail).not.toHaveBeenCalled();
    expect(mockExtractFromEmail).not.toHaveBeenCalled();
    expect(poller.markSeen).not.toHaveBeenCalled();
  });

  it('skips non-school emails without marking them as read', async () => {
    const poller = makePoller({
      fetchUnseen: vi.fn().mockResolvedValue([rawEmail]),
    });
    const sm = makeStateManager();

    mockParseEmail.mockResolvedValue(parsedEmail);
    mockIsSchoolEmail.mockReturnValue(false);

    await processEmails(poller, sm);

    expect(mockExtractFromEmail).not.toHaveBeenCalled();
    expect(poller.markSeen).not.toHaveBeenCalled();
  });

  it('sends SMS alert on extraction failure', async () => {
    const poller = makePoller({
      fetchUnseen: vi.fn().mockResolvedValue([rawEmail]),
    });
    const sm = makeStateManager();

    mockParseEmail.mockResolvedValue(parsedEmail);
    mockIsSchoolEmail.mockReturnValue(true);
    mockExtractFromEmail.mockResolvedValue({
      events: [],
      actionItems: [],
      summary: '',
      extractionFailed: true,
    });

    await processEmails(poller, sm);

    expect(sm.saveProcessedEmail).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      errorMessage: 'Claude extraction returned no parsed output',
    }));
    expect(mockSendNotification).toHaveBeenCalledWith(expect.stringContaining('Failed to extract'));
  });

  it('connects when not connected', async () => {
    const poller = makePoller({
      isConnected: vi.fn().mockReturnValue(false),
    });
    const sm = makeStateManager();

    await processEmails(poller, sm);

    expect(poller.connect).toHaveBeenCalled();
  });

  it('continues when calendar event creation fails', async () => {
    vi.useFakeTimers();

    const poller = makePoller({
      fetchUnseen: vi.fn().mockResolvedValue([rawEmail]),
    });
    const sm = makeStateManager();

    mockParseEmail.mockResolvedValue(parsedEmail);
    mockIsSchoolEmail.mockReturnValue(true);
    mockExtractFromEmail.mockResolvedValue(extraction);
    mockCreateCalendarEvent.mockRejectedValue(new Error('Google API error'));
    mockCreateActionItemReminder.mockResolvedValue('cal-id-2');

    const promise = processEmails(poller, sm);
    // Advance past all retry delays (1s + 4s + 16s = 21s) x2 for event + action item
    await vi.advanceTimersByTimeAsync(50000);
    await promise;

    // Event was saved to DB even though calendar creation failed
    expect(sm.saveEvent).toHaveBeenCalled();
    expect(sm.updateEventCalendarId).not.toHaveBeenCalled();
    // Action item still processed
    expect(sm.saveActionItem).toHaveBeenCalled();
    expect(poller.markSeen).not.toHaveBeenCalled();
  });

  it('records failure when parse throws', async () => {
    const poller = makePoller({
      fetchUnseen: vi.fn().mockResolvedValue([rawEmail]),
    });
    const sm = makeStateManager();

    mockParseEmail.mockRejectedValue(new Error('parse error'));

    await processEmails(poller, sm);

    expect(sm.saveProcessedEmail).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      errorMessage: 'parse error',
    }));
    expect(poller.markSeen).not.toHaveBeenCalled();
  });

  it('handles action item calendar failure gracefully', async () => {
    vi.useFakeTimers();

    const poller = makePoller({
      fetchUnseen: vi.fn().mockResolvedValue([rawEmail]),
    });
    const sm = makeStateManager();

    mockParseEmail.mockResolvedValue(parsedEmail);
    mockIsSchoolEmail.mockReturnValue(true);
    mockExtractFromEmail.mockResolvedValue(extraction);
    mockCreateCalendarEvent.mockResolvedValue('cal-id-1');
    mockCreateActionItemReminder.mockRejectedValue(new Error('Calendar error'));

    const promise = processEmails(poller, sm);
    await vi.advanceTimersByTimeAsync(50000);
    await promise;

    expect(sm.saveActionItem).toHaveBeenCalled();
    expect(sm.updateActionItemCalendarId).not.toHaveBeenCalled();
    expect(poller.markSeen).not.toHaveBeenCalled();
  });

  it('skips duplicate events', async () => {
    const poller = makePoller({
      fetchUnseen: vi.fn().mockResolvedValue([rawEmail]),
    });
    const sm = makeStateManager({
      findDuplicateEvent: vi.fn().mockReturnValue({ id: 99, title: 'Field Trip' }),
    });

    mockParseEmail.mockResolvedValue(parsedEmail);
    mockIsSchoolEmail.mockReturnValue(true);
    mockExtractFromEmail.mockResolvedValue(extraction);
    mockCreateActionItemReminder.mockResolvedValue('cal-id-2');

    await processEmails(poller, sm);

    expect(sm.saveEvent).not.toHaveBeenCalled();
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
    // Action items still processed
    expect(sm.saveActionItem).toHaveBeenCalled();
  });

  it('skips duplicate action items', async () => {
    const poller = makePoller({
      fetchUnseen: vi.fn().mockResolvedValue([rawEmail]),
    });
    const sm = makeStateManager({
      findDuplicateActionItem: vi.fn().mockReturnValue({ id: 99, title: 'Permission Slip' }),
    });

    mockParseEmail.mockResolvedValue(parsedEmail);
    mockIsSchoolEmail.mockReturnValue(true);
    mockExtractFromEmail.mockResolvedValue(extraction);
    mockCreateCalendarEvent.mockResolvedValue('cal-id-1');

    await processEmails(poller, sm);

    expect(sm.saveActionItem).not.toHaveBeenCalled();
    expect(mockCreateActionItemReminder).not.toHaveBeenCalled();
    // Events still processed
    expect(sm.saveEvent).toHaveBeenCalled();
  });

  it('handles action item with null calendar id (no deadline)', async () => {
    const poller = makePoller({
      fetchUnseen: vi.fn().mockResolvedValue([rawEmail]),
    });
    const sm = makeStateManager();

    mockParseEmail.mockResolvedValue(parsedEmail);
    mockIsSchoolEmail.mockReturnValue(true);
    mockExtractFromEmail.mockResolvedValue(extraction);
    mockCreateCalendarEvent.mockResolvedValue('cal-id-1');
    mockCreateActionItemReminder.mockResolvedValue(null); // no deadline

    await processEmails(poller, sm);

    expect(sm.updateActionItemCalendarId).not.toHaveBeenCalled();
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const result = await withRetry(fn, 'test');

    expect(result).toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockResolvedValueOnce('success');

    // Use maxRetries=1 with real timers (1s delay is acceptable)
    const result = await withRetry(fn, 'test', 1);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    // maxRetries=0 means only 1 attempt, no delay
    await expect(withRetry(fn, 'test', 0)).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
