# kid-cal

School email → calendar + SMS reminder daemon.

## Architecture

Yahoo IMAP → EmailPoller → EmailFilter → EmailParser → ClaudeExtractor → StateManager (SQLite) → CalendarService (Google) + ReminderScheduler → TwilioService (SMS)

## Build & Run

```bash
npm run build     # TypeScript compile
npm run dev       # Run with tsx (dev)
npm start         # Run compiled JS
npm test          # Run vitest
npm run logs      # Follow daemon log, human-readable (requires jq)
npm run logs:errors   # Errors only (level>=50), whole history
```

## Project Structure

- `src/config.ts` - Zod-validated env config
- `src/email/` - IMAP polling, parsing (mailparser + html-to-text), school sender filtering
- `src/extraction/` - Claude API structured output extraction (events + action items)
- `src/calendar/` - Google Calendar service account integration
- `src/reminders/` - Twilio SMS + reminder scheduling
- `src/state/` - SQLite (better-sqlite3, WAL mode) state management

## Key Patterns

- ESM modules (`"type": "module"` in package.json, `.js` extensions in imports)
- Snake_case for DB column names and Stored* types (matches better-sqlite3 raw output)
- CamelCase for application-layer types (Extracted*, Parsed*)
- Deterministic iCalUID for idempotent calendar event creation
- Read-only IMAP: emails are never marked as read; dedup via DB `processed_emails` table + in-memory cache for non-school emails
- Orphaned calendar event retry: items with NULL `calendar_event_id` are retried each poll cycle
- Exponential backoff retry (1s, 4s, 16s) for external services
- SMS alert after 3 consecutive IMAP failures
- Heartbeat file written each poll cycle (`writeHeartbeat`), checked by the external watchdog

## Daemon (launchd)

```bash
# Install
cp com.kid-cal.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.kid-cal.plist

# Start/stop/restart
launchctl start com.kid-cal
launchctl stop com.kid-cal
launchctl stop com.kid-cal && launchctl start com.kid-cal

# Check status (PID, exit code, label)
launchctl list | grep kid-cal

# Uninstall
launchctl unload ~/Library/LaunchAgents/com.kid-cal.plist

# Rebuild and restart after code changes
npm run build && launchctl stop com.kid-cal && launchctl start com.kid-cal

# Logs
npm run logs                  # readable live tail
npm run logs:errors           # errors only
tail -f kid-cal.log           # raw stdout (pino JSON)
tail -f kid-cal-error.log     # stderr — should stay empty

# Inspect database
sqlite3 kid-cal.db ".headers on" ".mode column" "SELECT * FROM action_items;"
sqlite3 kid-cal.db "SELECT * FROM processed_emails;"
sqlite3 kid-cal.db "SELECT * FROM events;"
sqlite3 kid-cal.db "SELECT * FROM sent_reminders;"
```

## Watchdog (launchd)

External liveness check — the daemon cannot alert on failures that stop it from starting.

```bash
# Install
cp com.kid-cal-watchdog.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.kid-cal-watchdog.plist

# Run a check by hand
sh scripts/kid-cal-watchdog.sh

# Status / logs
launchctl list | grep kid-cal-watchdog
tail -f kid-cal-watchdog.log
```

`scripts/kid-cal-watchdog.sh` is POSIX sh + curl by design — it must keep working when
node_modules is missing, which is the failure it exists to catch. Do not add Node to it.

## Testing

Tests use vitest. Test files mirror src/ structure in tests/.
