#!/bin/sh
# T2 INGESTION. The scheduled ingest jobs, as code.
#
# WHY THIS FILE EXISTS. It used to PRINT a crontab line and refuse to install it, on the reasoning
# that a build lane writing an operator's crontab is how two lanes end up owning one schedule. That
# was right about ownership and wrong about the consequence: the line got installed by hand, then
# existed in exactly one place in the world with no code that reproduces it and nothing that could
# say whether it was still there. Rebuild the box and the capture stops, silently, and the only
# symptom is a feed day that quietly stops advancing while every screen renders with full
# confidence. The publisher destroys its daily files on a rolling window, so a capture that stops
# without saying so costs days that cannot be bought back at any price.
#
# ---------------------------------------------------------------------------------------------
# TWO DEFECTS THIS FILE SHIPPED, BOTH FOUND IN PRODUCTION, BOTH THE SAME LAW IN A DIFFERENT COAT.
# Read them before changing anything here, because the obvious edit reintroduces one of them.
#
#   1. --check ONLY LOOKED FOR ITS OWN MARKER BLOCK, so on the one host where the capture was
#      genuinely running, installed by hand months earlier, it reported "the daily government feed
#      capture is NOT scheduled on this host". Both sentences false, and false in the direction that
#      makes an operator install a SECOND copy.
#
#   2. --apply ONLY STRIPPED ITS OWN MARKER BLOCK before appending, so adopting a hand-written line
#      left that line in place and put the managed block beside it. The host was then scheduled to
#      run the capture TWICE at the same minute. The read-back PASSED, because it read back its own
#      block and found it correct, and never asked whether that block was the only copy on the box.
#
#   > AN INSTRUMENT THAT ONLY EXAMINES ITS OWN HANDIWORK CONFIRMS YOUR WRITE, NOT THE STATE OF THE
#   > SYSTEM. Ask the question the operator actually has ("will it run tomorrow, exactly once?"),
#   > never the question your code is positioned to answer ("is my line where I put it?").
#
# ---------------------------------------------------------------------------------------------
# MULTIPLE JOBS, ONE MANAGER. A second scheduled ingest arrived (the dated price series) and the
# choice was to hand-add a line beside the managed block or to teach this file about more than one
# job. Hand-adding is EXACTLY what produced defect 2, so this manages a TABLE of jobs, each in its
# own marker block, each adopted and counted independently.
#
#   install-cron.sh                    print every job's block, change nothing (default)
#   install-cron.sh --print [job|all]  print one job's block, or all
#   install-cron.sh --apply [job|all]  install or ADOPT, then read back AND assert exactly one
#   install-cron.sh --check [job|all]  0 installed+identical · 1 absent · 2 drifted · 3 unmanaged
#
# With `all`, the WORST state found is the exit code, so a deploy can gate on it.

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="\$HOME/onlysource-capture-logs"

# ---------------------------------------------------------------------------------------------
# THE JOB TABLE. Adding a scheduled ingest is a row here, never a hand-edited crontab.
# `job_match` identifies the job's line ANYWHERE in the crontab, managed or not. It is what makes
# adoption and the exactly-once assertion work, so it must be specific enough that no other job
# could match it.
# ---------------------------------------------------------------------------------------------
job_ids() { printf '%s\n' capture series; }

job_schedule() {
  case "$1" in
    capture) printf '15 6 * * 1-6' ;;
    series)  printf '30 6 * * *' ;;
  esac
}

job_command() {
  case "$1" in
    capture) printf 'npx tsx scripts/ingest/capture-day.mts' ;;
    series)  printf 'npm run ingest:series' ;;
  esac
}

job_match() {
  case "$1" in
    capture) printf 'capture-day' ;;
    series)  printf 'ingest:series' ;;
  esac
}

job_title() {
  case "$1" in
    capture) printf 'daily DIBBS capture' ;;
    series)  printf 'dated price series' ;;
  esac
}

# THE MARKER NAME IS A MIGRATION SURFACE, NOT A LABEL, AND RENAMING IT SILENTLY ORPHANS A BLOCK.
#
# This file previously managed exactly one job under the marker "ONLYSOURCE daily DIBBS capture",
# and that block is installed on production right now. Generalising to a job table tempted me to
# rename it to the short id, which reads better and would have been a real defect: --check would
# have found no block under the NEW marker, correctly reported UNMANAGED, and --apply would have
# stripped the old COMMAND line while leaving the old MARKER COMMENTS behind as orphans.
#
# So the capture keeps its original marker text, byte for byte. A new job may choose any name; an
# existing one may never change it without a migration that removes the old markers explicitly.
job_marker_name() {
  case "$1" in
    capture) printf 'daily DIBBS capture' ;;
    series)  printf 'dated price series' ;;
  esac
}

# TIMING. The feed publisher posts a day's files by early morning Eastern, so the capture runs 06:15
# America/New_York Monday to Saturday (Saturday picks up Friday; capture-day walks back over
# unpublished days itself, so a holiday morning is a clean no-op and not an error). The series job
# runs at 06:30 so the two never overlap on the box.
#
# WHY THE SERIES JOB RUNS DAILY FOR A MONTHLY PUBLICATION: the publisher releases mid-month and the
# ingest is idempotent (a second run appends nothing and says so), so a daily run that finds nothing
# new costs two paced requests and removes the need for anyone to remember a release calendar.
# A DATED SERIES THAT NOTHING REFRESHES IS JUST A SLOWER-MOVING STALE CONSTANT, which is precisely
# the defect the series work exists to end.

begin_marker() { printf '# >>> ONLYSOURCE %s (managed by scripts/ingest/install-cron.sh) >>>' "$(job_marker_name "$1")"; }
end_marker()   { printf '# <<< ONLYSOURCE %s <<<' "$(job_marker_name "$1")"; }

# The managed block for one job. Everything between the markers is owned by this file and replaced
# wholesale, so re-running never appends a second copy and an operator's unrelated lines are never
# touched. The markers are the ownership boundary and they are the whole reason this is safe.
block() {
  id="$1"
  printf '%s\n' "$(begin_marker "$id")"
  printf '%s\n' "CRON_TZ=America/New_York"
  printf '%s\n' "$(job_schedule "$id") cd ${REPO_ROOT} && $(job_command "$id") >> ${LOG_DIR}/${id}-\$(date +\\%Y\\%m\\%d).log 2>&1"
  printf '%s\n' "$(end_marker "$id")"
}

current_crontab() { crontab -l 2>/dev/null || true; }

installed_block() {
  current_crontab | sed -n "\|^$(begin_marker "$1")\$|,\|^$(end_marker "$1")\$|p"
}

# Everything EXCEPT this job's managed block. Used to detect unmanaged copies and to rebuild.
without_managed_block() {
  current_crontab | sed "\|^$(begin_marker "$1")\$|,\|^$(end_marker "$1")\$|d"
}

# Is this job scheduled at all, by any means, outside our own block? See defect 1.
unmanaged_count() {
  without_managed_block "$1" | command grep -c "$(job_match "$1")" 2>/dev/null || true
}

# Every occurrence anywhere, managed or not. See defect 2: this is the question that matters.
total_count() {
  current_crontab | command grep -c "$(job_match "$1")" 2>/dev/null || true
}

check_one() {
  id="$1"
  have="$(installed_block "$id")"
  unmanaged="$(unmanaged_count "$id")"
  title="$(job_title "$id")"

  if [ -z "$have" ] && [ "${unmanaged:-0}" -gt 0 ]; then
    echo "[$id] UNMANAGED: the $title IS scheduled here, and NOT by this script."
    without_managed_block "$id" | command grep -n "$(job_match "$id")" | sed 's/^/    /'
    echo "    The job WILL run. What is missing is reproducibility: nothing in the repo recreates"
    echo "    that line, so a rebuilt host loses it silently. Run --apply $id to adopt it, which"
    echo "    REPLACES the hand-written line rather than adding a second one."
    return 3
  fi
  if [ -z "$have" ]; then
    echo "[$id] ABSENT: the $title is not scheduled here by any means. It will NOT run."
    return 1
  fi
  if [ "$have" = "$(block "$id")" ]; then
    echo "[$id] INSTALLED and identical to this file."
    printf '%s\n' "$have" | sed 's/^/    /'
    return 0
  fi
  echo "[$id] DRIFTED: a managed block is installed and is NOT what this file says."
  echo "    --- installed ---"; printf '%s\n' "$have" | sed 's/^/    /'
  echo "    --- expected ----"; block "$id" | sed 's/^/    /'
  return 2
}

apply_one() {
  id="$1"
  eval "LOG_DIR_REAL=${LOG_DIR}"
  mkdir -p "$LOG_DIR_REAL"

  # ADOPTION, NOT MERE REPLACEMENT. Strip this job's managed block AND any unmanaged line running
  # the same job, then append exactly one managed block. A CRON_TZ is removed only when the very
  # next line is this job's line, because that is the pairing this script creates; an operator's
  # CRON_TZ above some other job is left alone, since silently moving an unrelated job into another
  # timezone would be a worse bug than the one being fixed.
  tmp="$(mktemp)"
  without_managed_block "$id" | awk -v pat="$(job_match "$id")" '
    { line[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        if (index(line[i], pat) > 0) continue
        if (line[i] ~ /^CRON_TZ=/ && i < NR && index(line[i+1], pat) > 0) continue
        print line[i]
      }
    }' > "$tmp"
  if [ -s "$tmp" ] && [ "$(tail -c 1 "$tmp" | wc -l | tr -d ' ')" = "0" ]; then printf '\n' >> "$tmp"; fi
  block "$id" >> "$tmp"
  crontab "$tmp"
  rm -f "$tmp"

  # READ IT BACK. crontab(1) can accept a file and the daemon can still reject a line.
  have="$(installed_block "$id")"
  if [ "$have" != "$(block "$id")" ]; then
    echo "[$id] FAILED: written, and it does not read back as expected."
    printf '%s\n' "$have" | sed 's/^/    /'
    return 1
  fi

  # THE ASSERTION DEFECT 2 DID NOT MAKE. Reading the block back proves the block is there. It does
  # NOT prove the block is the only copy on the host, which is the property that matters.
  total="$(total_count "$id")"
  if [ "${total:-0}" != "1" ]; then
    echo "[$id] FAILED: this job appears ${total} times and must appear exactly once."
    current_crontab | command grep -n "$(job_match "$id")" | sed 's/^/    /'
    echo "    Remove the extra line(s) by hand and re-run. Two runs at one minute double the load"
    echo "    on a publisher for no extra data."
    return 1
  fi

  echo "[$id] INSTALLED and verified: reads back correctly AND appears exactly once."
  printf '%s\n' "$have" | sed 's/^/    /'
  return 0
}

worst=0
found=0
run_over() {
  action="$1"; target="${2:-all}"
  for id in $(job_ids); do
    if [ "$target" != "all" ] && [ "$target" != "$id" ]; then continue; fi
    found=1
    set +e
    "$action" "$id"
    rc=$?
    set -e
    [ "$rc" -gt "$worst" ] && worst=$rc
  done
  if [ "$found" != "1" ]; then
    echo "unknown job: $target (known: $(job_ids | tr '\n' ' ')all)" >&2
    exit 64
  fi
}

case "${1:-}" in
  --check)
    run_over check_one "${2:-all}"
    # CRON_TZ is honoured by Vixie cron and cronie and ignored by some minimal daemons. An ignored
    # CRON_TZ is not cosmetic: on a UTC host it moves a 06:15 Eastern job to 02:15 Eastern, hours
    # before the publisher posts, so every run would find nothing and report success.
    exit "$worst"
    ;;
  --apply)
    run_over apply_one "${2:-all}"
    echo "log directory: $(eval "echo ${LOG_DIR}")"
    echo "cron daemon: $( (command -v cron || command -v crond || echo 'not found on PATH') 2>/dev/null )"
    echo "CRON_TZ is honoured by Vixie cron and cronie. On any other daemon, convert the schedules"
    echo "into the host's own zone before trusting them."
    exit "$worst"
    ;;
  ''|--print)
    echo "# Print only. Nothing was changed. --apply installs, --check verifies."
    echo "# mkdir -p ${LOG_DIR} first if you install by hand."
    for id in $(job_ids); do
      if [ -n "${2:-}" ] && [ "$2" != "all" ] && [ "$2" != "$id" ]; then continue; fi
      block "$id"
    done
    exit 0
    ;;
  *)
    echo "usage: install-cron.sh [--print|--apply|--check] [capture|series|all]" >&2
    exit 64
    ;;
esac
