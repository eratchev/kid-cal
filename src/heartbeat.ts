import { renameSync, unlinkSync, writeFileSync } from 'fs';
import { getConfig } from './config.js';
import { getLogger } from './logger.js';

/**
 * Record that the daemon completed a poll cycle.
 *
 * Stored as epoch seconds so `scripts/kid-cal-watchdog.sh` can read it with plain shell.
 * The watchdog deliberately depends on nothing from node_modules — a daemon that cannot
 * start is exactly the failure it exists to catch, so it must survive a broken install.
 *
 * Writes to a temp file and renames, so a concurrent watchdog run can never observe a
 * half-written file. Never throws: a healthy daemon must not die over a heartbeat.
 */
export function writeHeartbeat(): void {
  const path = getConfig().HEARTBEAT_PATH;
  const tmpPath = `${path}.tmp`;

  try {
    writeFileSync(tmpPath, `${Math.floor(Date.now() / 1000)}\n`);
    renameSync(tmpPath, path);
  } catch (error) {
    getLogger().warn({ error, path }, 'Failed to write heartbeat');
    try {
      unlinkSync(tmpPath);
    } catch {
      // Nothing to clean up
    }
  }
}
