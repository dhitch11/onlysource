#!/bin/sh
# T2 INGESTION. The daily DIBBS capture schedule, as code.
#
# WHY THIS CHANGED. This script used to PRINT the crontab line and refuse to install it, on the
# reasoning that a build lane writing an operator's crontab is how two lanes end up owning one
# schedule. That reasoning was right about ownership and wrong about the consequence. What
# actually happened is that the line was installed by hand on the droplet, correctly, and then
# existed in exactly one place in the world with no code that reproduces it and nothing that can
# tell you whether it is still there. Rebuild the box and the capture stops, silently, and the
# only symptom is a feed day that quietly stops advancing while every screen keeps rendering with
# full confidence. DIBBS destroys its daily files on a rolling window, so a capture that stops
# without saying so costs days that cannot be bought back at any price.
#
# So: printing is still the default, because a script that mutates a schedule when you merely run
# it is its own hazard. But installation and verification are now real, idempotent operations you
# can run from a deploy, and DRIFT between what is installed and what this file says is now a
# thing you can detect rather than a thing you find out about in three weeks.
#
#   install-cron.sh            print the block, change nothing (default, unchanged contract)
#   install-cron.sh --apply    install or replace the block, then read it back and verify
#   install-cron.sh --check    exit 0 if installed and identical, 1 if absent, 2 if drifted
#
# Timing: DLA posts a feed day's files by early morning Eastern. 06:15 America/New_York, Monday
# through Saturday (Saturday picks up Friday's files; capture-day walks back over unpublished days
# on its own, so a holiday morning is a clean no-op and not an error). CRON_TZ pins the schedule to
# the publisher's clock. Vixie and cronie honour it; --apply verifies the daemon accepted the
# variable rather than assuming, because a CRON_TZ silently ignored runs the capture at 06:15 in
# the box's own zone, which on a UTC droplet is 02:15 Eastern, four hours before DLA publishes.
#
# The command runs from the repo root so tsx sees tsconfig.json, and appends to a log the operator
# can read at 6am. capture-day.mts re-execs itself with the react-server module condition, so the
# line needs no NODE_OPTIONS of its own.

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="\$HOME/onlysource-capture-logs"
BEGIN="# >>> ONLYSOURCE daily DIBBS capture (managed by scripts/ingest/install-cron.sh) >>>"
END="# <<< ONLYSOURCE daily DIBBS capture <<<"

# The managed block. Everything between the markers is owned by this file and replaced wholesale,
# so re-running never appends a second copy and an operator's own unrelated cron lines are never
# touched. The markers are the ownership boundary and they are the whole reason this is safe.
block() {
  printf '%s\n' "$BEGIN"
  printf '%s\n' "CRON_TZ=America/New_York"
  printf '%s\n' "15 6 * * 1-6 cd ${REPO_ROOT} && npx tsx scripts/ingest/capture-day.mts >> ${LOG_DIR}/capture-\$(date +\\%Y\\%m\\%d).log 2>&1"
  printf '%s\n' "$END"
}

current_crontab() { crontab -l 2>/dev/null || true; }

# The installed block, or empty. sed rather than grep so the whole span comes back in order.
installed_block() {
  current_crontab | sed -n "\|^${BEGIN}\$|,\|^${END}\$|p"
}

case "${1:-}" in
  --check)
    have="$(installed_block)"
    if [ -z "$have" ]; then
      echo "ABSENT: no managed capture block in this user's crontab."
      echo "The daily government feed capture is NOT scheduled on this host."
      exit 1
    fi
    if [ "$have" = "$(block)" ]; then
      echo "INSTALLED and identical to scripts/ingest/install-cron.sh."
      current_crontab | sed -n "\|^${BEGIN}\$|,\|^${END}\$|p" | sed 's/^/  /'
      exit 0
    fi
    echo "DRIFTED: a managed block is installed and it is NOT what this file says it should be."
    echo "--- installed ---"; printf '%s\n' "$have" | sed 's/^/  /'
    echo "--- expected ----"; block | sed 's/^/  /'
    echo "Run --apply to replace it, after satisfying yourself the difference was not deliberate."
    exit 2
    ;;

  --apply)
    eval "LOG_DIR_REAL=${LOG_DIR}"
    mkdir -p "$LOG_DIR_REAL"

    # Strip any existing managed block, keep everything else exactly as it was, append ours.
    tmp="$(mktemp)"
    current_crontab | sed "\|^${BEGIN}\$|,\|^${END}\$|d" > "$tmp"
    # A crontab whose last line lacks a newline swallows the line appended after it.
    if [ -s "$tmp" ] && [ "$(tail -c 1 "$tmp" | wc -l | tr -d ' ')" = "0" ]; then printf '\n' >> "$tmp"; fi
    block >> "$tmp"
    crontab "$tmp"
    rm -f "$tmp"

    # READ IT BACK. Writing a crontab and reporting success is the same failure shape this whole
    # file exists to prevent: crontab(1) can accept a file and the daemon can still reject a line.
    have="$(installed_block)"
    if [ "$have" != "$(block)" ]; then
      echo "FAILED: the crontab was written and does not read back as expected."
      printf '%s\n' "$have" | sed 's/^/  /'
      exit 1
    fi
    echo "INSTALLED and verified by read-back:"
    printf '%s\n' "$have" | sed 's/^/  /'
    echo "log directory: $LOG_DIR_REAL"

    # CRON_TZ is honoured by Vixie cron and cronie and ignored by some minimal cron daemons. An
    # ignored CRON_TZ is not a cosmetic problem: on a UTC host it moves the run to 02:15 Eastern,
    # four hours before DLA publishes, so every capture would find a 404 and walk backwards
    # forever while reporting success. Name the daemon so a human can settle it in one look.
    if [ -r /proc/1/comm ] || command -v dpkg >/dev/null 2>&1 || command -v rpm >/dev/null 2>&1; then
      daemon="$( (command -v cron || command -v crond || echo 'not found on PATH') 2>/dev/null )"
      echo "cron daemon: $daemon"
      echo "CRON_TZ is honoured by Vixie cron and cronie. If this host runs a different daemon,"
      echo "convert 06:15 America/New_York into the host's own zone before trusting the schedule."
    fi
    exit 0
    ;;

  ''|--print)
    echo "# Print only. Nothing was changed. Use --apply to install, --check to verify."
    echo "# mkdir -p ${LOG_DIR} first if you install this by hand."
    block
    exit 0
    ;;

  *)
    echo "usage: install-cron.sh [--print | --apply | --check]" >&2
    exit 64
    ;;
esac
