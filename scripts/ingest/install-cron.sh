#!/bin/sh
# T2 INGESTION. Print the crontab line for the daily DIBBS capture. PRINT ONLY:
# this script never edits a crontab. The main session installs it on the droplet, because
# a build lane writing an operator's crontab is how two lanes end up owning one schedule.
#
# Timing: DLA posts a feed day's files by early morning Eastern. 06:15 America/New_York,
# Monday through Saturday (Saturday picks up Friday's files; capture-day walks back over
# unpublished days on its own, so a holiday morning is a clean no-op, not an error).
# CRON_TZ pins the schedule to the publisher's clock; verify the droplet's cron honors
# CRON_TZ (Vixie/cronie do) or convert 06:15 ET to the box's zone before installing.
#
# The command runs from the repo root so tsx sees tsconfig.json, and appends to a log the
# operator can read at 6am. capture-day.mts re-execs itself with the react-server module
# condition, so the line needs no NODE_OPTIONS of its own.

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="\$HOME/onlysource-capture-logs"

cat <<LINE
# --- ONLYSOURCE daily DIBBS capture (print of $(date -u +%Y-%m-%dT%H:%M:%SZ); install by hand) ---
# mkdir -p ${LOG_DIR} first.
CRON_TZ=America/New_York
15 6 * * 1-6 cd ${REPO_ROOT} && npx tsx scripts/ingest/capture-day.mts >> ${LOG_DIR}/capture-\$(date +\%Y\%m\%d).log 2>&1
LINE
