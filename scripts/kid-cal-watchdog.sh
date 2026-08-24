#!/bin/sh
# kid-cal watchdog — alerts via Telegram when the daemon is not running or has stopped cycling.
#
# Deliberately dependency-free (POSIX sh + curl only). The outage this exists to catch was a
# deleted node_modules that left the daemon crash-looping for 85 days; a watchdog written in
# Node would have been just as dead. Do not give this script a Node or npm dependency.
set -u

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_DIR/.env"
STATE_FILE="$REPO_DIR/.kid-cal-watchdog.state"
LABEL="com.kid-cal"

# Heartbeat is written every POLL_INTERVAL_MINUTES (default 5), so an hour is 12 missed cycles.
STALE_SECONDS="${KID_CAL_STALE_SECONDS:-3600}"
RENOTIFY_SECONDS="${KID_CAL_RENOTIFY_SECONDS:-43200}"

now=$(date +%s)

# Read one KEY=value out of .env, stripping optional surrounding quotes. Deliberately not
# `source`-ing the file: GOOGLE_PRIVATE_KEY contains quotes and escaped newlines.
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

BOT_TOKEN=$(env_get TELEGRAM_BOT_TOKEN)
CHAT_ID=$(env_get TELEGRAM_CHAT_ID)
HEARTBEAT_PATH=$(env_get HEARTBEAT_PATH)
[ -n "$HEARTBEAT_PATH" ] || HEARTBEAT_PATH="./kid-cal.heartbeat"
case "$HEARTBEAT_PATH" in
  /*) ;;
  *) HEARTBEAT_PATH="$REPO_DIR/${HEARTBEAT_PATH#./}" ;;
esac

if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
  echo "watchdog: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not found in $ENV_FILE" >&2
  exit 1
fi

notify() {
  curl -sS --max-time 20 -o /dev/null \
    -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
    --data-urlencode "chat_id=$CHAT_ID" \
    --data-urlencode "text=$1" \
    || echo "watchdog: failed to send Telegram alert" >&2
}

# State file holds: "<epoch of last alert> <epoch of last run>"
last_alert=0
last_run=0
if [ -f "$STATE_FILE" ]; then
  read -r last_alert last_run < "$STATE_FILE" 2>/dev/null || true
fi
case "${last_alert:-}" in ''|*[!0-9]*) last_alert=0 ;; esac
case "${last_run:-}" in ''|*[!0-9]*) last_run=0 ;; esac

# This is a laptop: it sleeps. If our own previous run was long ago, the machine was asleep
# or powered off, so a stale heartbeat proves nothing — re-arm and check again next interval.
slept=0
if [ "$last_run" -gt 0 ] && [ $((now - last_run)) -gt "$STALE_SECONDS" ]; then
  slept=1
fi

problem=""

job=$(launchctl list "$LABEL" 2>/dev/null) || job=""
if [ -z "$job" ]; then
  problem="kid-cal is not loaded in launchd. Run: launchctl load ~/Library/LaunchAgents/$LABEL.plist"
else
  pid=$(printf '%s\n' "$job" | sed -n 's/.*"PID" = \([0-9]*\).*/\1/p')
  exit_status=$(printf '%s\n' "$job" | sed -n 's/.*"LastExitStatus" = \([0-9]*\).*/\1/p')

  if [ -z "$pid" ]; then
    problem="kid-cal is not running (last exit status ${exit_status:-unknown}). Most likely crash-looping — check kid-cal-error.log."
  elif [ "$slept" -eq 0 ]; then
    if [ ! -f "$HEARTBEAT_PATH" ]; then
      problem="kid-cal is running (pid $pid) but has never written a heartbeat."
    else
      beat=$(head -1 "$HEARTBEAT_PATH" 2>/dev/null | tr -dc '0-9')
      [ -n "$beat" ] || beat=0
      age=$((now - beat))
      if [ "$age" -gt "$STALE_SECONDS" ]; then
        problem="kid-cal is running (pid $pid) but has not completed a poll cycle in $((age / 60)) minutes."
      fi
    fi
  fi
fi

if [ -n "$problem" ]; then
  if [ $((now - last_alert)) -ge "$RENOTIFY_SECONDS" ]; then
    notify "🚨 kid-cal watchdog: $problem"
    last_alert=$now
  fi
elif [ "$last_alert" -gt 0 ]; then
  notify "✅ kid-cal watchdog: daemon is healthy again."
  last_alert=0
fi

printf '%s %s\n' "$last_alert" "$now" > "$STATE_FILE"
