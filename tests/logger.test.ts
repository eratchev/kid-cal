import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    LOG_LEVEL: 'warn',
  }),
}));

const mockPino = vi.fn().mockReturnValue({
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
  level: 'warn',
});

vi.mock('pino', () => ({
  default: (...args: unknown[]) => mockPino(...args),
}));

import { getLogger } from '../src/logger.js';

describe('getLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a logger instance', () => {
    const logger = getLogger();
    expect(logger).toBeDefined();
    expect(mockPino).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
    }));
  });

  it('caches on subsequent calls', () => {
    const first = getLogger();
    const second = getLogger();
    expect(first).toBe(second);
  });
});
