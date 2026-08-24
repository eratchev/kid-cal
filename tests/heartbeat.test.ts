import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let heartbeatPath = '';

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ HEARTBEAT_PATH: heartbeatPath }),
}));

const mockWarn = vi.fn();
vi.mock('../src/logger.js', () => ({
  getLogger: () => ({ info: () => {}, debug: () => {}, warn: mockWarn, error: () => {} }),
}));

import { writeHeartbeat } from '../src/heartbeat.js';

describe('writeHeartbeat', () => {
  let dir = '';

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'kid-cal-hb-'));
    heartbeatPath = join(dir, 'kid-cal.heartbeat');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the current time as epoch seconds', () => {
    const before = Math.floor(Date.now() / 1000);
    writeHeartbeat();
    const after = Math.floor(Date.now() / 1000);

    const written = Number(readFileSync(heartbeatPath, 'utf8').trim());
    expect(Number.isInteger(written)).toBe(true);
    expect(written).toBeGreaterThanOrEqual(before);
    expect(written).toBeLessThanOrEqual(after);
  });

  it('overwrites a previous heartbeat rather than appending', () => {
    writeFileSync(heartbeatPath, '1\n');
    writeHeartbeat();

    const contents = readFileSync(heartbeatPath, 'utf8');
    expect(contents.trim().split('\n')).toHaveLength(1);
    expect(Number(contents.trim())).toBeGreaterThan(1);
  });

  it('leaves no temp files behind (atomic replace)', () => {
    writeHeartbeat();
    expect(readdirSync(dir)).toEqual(['kid-cal.heartbeat']);
  });

  it('does not throw when the heartbeat cannot be written', () => {
    heartbeatPath = join(dir, 'no-such-subdir', 'kid-cal.heartbeat');

    expect(() => writeHeartbeat()).not.toThrow();
    expect(mockWarn).toHaveBeenCalled();
  });
});
