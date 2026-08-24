#!/bin/sh
# Human-readable views over kid-cal's pino JSON log.
#
#   scripts/logs.sh          follow the log live
#   scripts/logs.sh errors   every error in the history
#
# Wired up as `npm run logs` and `npm run logs:errors`.
set -u

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${KID_CAL_LOG:-$REPO_DIR/kid-cal.log}"
UNIT="kid-cal.service"

if ! command -v jq >/dev/null 2>&1; then
  echo "logs: jq is required (brew install jq / apt install jq)" >&2
  exit 1
fi

# Emit raw pino JSON lines from wherever this host keeps them: a file under launchd on
# macOS, or the journal under systemd on Linux.  $1 is "follow" or "history".
raw_lines() {
  if [ -f "$LOG_FILE" ]; then
    if [ "$1" = follow ]; then tail -n 40 -f "$LOG_FILE"; else cat "$LOG_FILE"; fi
  elif command -v journalctl >/dev/null 2>&1; then
    if [ "$1" = follow ]; then
      journalctl --user -u "$UNIT" -o cat -n 40 -f
    else
      journalctl --user -u "$UNIT" -o cat --no-pager
    fi
  else
    echo "logs: no $LOG_FILE, and no journalctl to read $UNIT from" >&2
    exit 1
  fi
}

STAMP='.time/1000|strflocaltime("%m-%d %H:%M:%S")'
LEVEL='{"10":"TRACE","20":"DEBUG","30":"INFO ","40":"WARN ","50":"ERROR","60":"FATAL"}[.level|tostring]//"?"'
# fromjson? drops anything that is not a pino line — journald interleaves stderr, and a
# crash writes a plain stack trace that would otherwise abort jq mid-stream.
PARSE='fromjson? // empty'

case "${1:-follow}" in
  follow)
    raw_lines follow | jq -Rr --unbuffered "
      $PARSE
      | ($STAMP) + \" \" + ($LEVEL) + \" \" + .msg
      + (if .count != null then \" (count=\\(.count))\" else \"\" end)
      + (if .title then \" — \\(.title)\" else \"\" end)"
    ;;
  errors)
    # Level 50+ only. Yahoo drops the idle IMAP connection between polls, so the
    # "IMAP connection error (will reconnect on next cycle)" warning is routine
    # level-40 noise that always ends in a successful reconnect and fetch.
    raw_lines history | jq -Rr "
      $PARSE
      | select(.level >= 50)
      | ($STAMP) + \" \" + ($LEVEL) + \" \" + .msg
      + (if .error.message then \"  \\(.error.message)\" else \"\" end)"
    ;;
  *)
    echo "usage: $(basename "$0") [follow|errors]" >&2
    exit 2
    ;;
esac
