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
LABEL="com.kid-cal"          # launchd (macOS)
UNIT="kid-cal.service"       # systemd (Linux)

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

# Echo the daemon's state as "<missing|stopped|running> <pid> <exit>", so the checks below
# read the same on macOS and Linux. '-' means "not applicable".
service_state() {
  if command -v launchctl >/dev/null 2>&1; then
    job=$(launchctl list "$LABEL" 2>/dev/null) || { echo "missing - -"; return; }
    pid=$(printf '%s\n' "$job" | sed -n 's/.*"PID" = \([0-9]*\).*/\1/p')
    status=$(printf '%s\n' "$job" | sed -n 's/.*"LastExitStatus" = \([0-9]*\).*/\1/p')
    if [ -n "$pid" ]; then echo "running $pid ${status:--}"; else echo "stopped - ${status:--}"; fi
  elif command -v systemctl >/dev/null 2>&1; then
    show=$(systemctl --user show "$UNIT" -p LoadState -p ActiveState -p MainPID -p ExecMainStatus 2>/dev/null) \
      || { echo "missing - -"; return; }
    load=$(printf '%s\n' "$show" | sed -n 's/^LoadState=//p')
    active=$(printf '%s\n' "$show" | sed -n 's/^ActiveState=//p')
    pid=$(printf '%s\n' "$show" | sed -n 's/^MainPID=//p')
    status=$(printf '%s\n' "$show" | sed -n 's/^ExecMainStatus=//p')
    if [ "$load" = "not-found" ] || [ -z "$load" ]; then echo "missing - -"; return; fi
    if [ "$active" = "active" ] && [ "${pid:-0}" != "0" ]; then
      echo "running $pid ${status:--}"
    else
      echo "stopped - ${status:--}"
    fi
  else
    echo "missing - -"
  fi
}

# Where to tell the reader to look, and how to bring the daemon back.
if command -v launchctl >/dev/null 2>&1; then
  LOG_HINT="check kid-cal-error.log"
  LOAD_HINT="launchctl load ~/Library/LaunchAgents/$LABEL.plist"
else
  LOG_HINT="check: journalctl --user -u $UNIT -n 50"
  LOAD_HINT="systemctl --user enable --now $UNIT"
fi

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

# Splitting the three fields into $1 $2 $3 is the point here.
# shellcheck disable=SC2046
set -- $(service_state)
state=$1; pid=$2; exit_status=$3

if [ "$state" = "missing" ]; then
  problem="kid-cal is not installed as a service. Run: $LOAD_HINT"
else
  if [ "$state" = "stopped" ]; then
    problem="kid-cal is not running (last exit status ${exit_status}). Most likely crash-looping — $LOG_HINT."
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
