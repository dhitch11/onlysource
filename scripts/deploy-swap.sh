#!/usr/bin/env bash
#
# ATOMIC DEPLOY. Build beside the running server, then swap.
#
# =============================================================================
# WHY THIS EXISTS, MEASURED, NOT FEARED
# =============================================================================
# 2026-08-19 02:01 UTC, during a live demo, `/enter` served HTTP 500 with a bare
# "Internal Server Error" on both hosts. The pm2 log named it:
#
#   InvariantError: The client reference manifest for route "/enter" does not exist
#   Failed to load static file for page: /500  ENOENT .next/server/pages/500.html
#
# Neither file was missing from the build. They were missing from the build BEING
# OVERWRITTEN UNDERNEATH THE RUNNING SERVER, because `npm run build` writes into the
# same `.next` the live process reads from. Both existed 53 seconds later.
#
# Signed-in traffic notices nothing: every app route is a correct 307 and every page
# still serves. THE ONLY ROUTE THAT BREAKS IS THE ONLY ROUTE AN ANONYMOUS VISITOR CAN
# LOAD. Anyone holding a cookie sees a perfect product; anyone arriving fresh sees a
# bare error with no boundary, because 500.html is being rewritten in the same instant.
# Production moved 14 times in one day.
#
# The deploy protocol could not see it BY CONSTRUCTION: it reads health and sweeps the
# routes AFTER the restart, so every check looks at the far side of the gap.
#
# =============================================================================
# WHAT THIS DOES DIFFERENTLY
# =============================================================================
#   1. builds into .next-staging while .next keeps serving
#   2. ASSERTS the two artifacts whose absence caused the outage actually exist
#   3. swaps by rename, which is atomic on one filesystem
#   4. restarts, then verifies /enter and the deployed commit
#   5. rolls back to the previous build on any failure, by rename
#
# The build no longer gates the restart by exit code alone. `npm run build` exited 0
# while emitting a tree that could not serve its own entry point, which is the third
# instance this week of an exit code read as an outcome. It gates on the ARTIFACTS.
#
# USAGE (on the droplet, from /opt/onlysource):
#   ./scripts/deploy-swap.sh            deploy origin/main
#   ./scripts/deploy-swap.sh --no-pull  deploy the working tree as-is
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ==========================================================================
# ★ THE FETCH REPLACES THIS FILE WHILE BASH IS READING IT. RE-EXEC FIRST.
#
# `git reset --hard origin/main` rewrites every tracked file, INCLUDING THIS
# ONE, and bash reads a script incrementally by byte offset rather than
# loading it whole. So the run that ships a change to this script executes
# the OLD text, and any run where the file's length shifts under the reader
# can execute the wrong bytes entirely. It worked by luck, not by design,
# and it was found by the conductor after a warm step that was on disk
# demonstrably did not run.
#
# So the fetch happens HERE, in the first few lines, and the script then
# REPLACES ITS OWN PROCESS with a fresh bash reading the new file from byte
# zero. After the exec, everything below is guaranteed to be the code that
# was just fetched.
#
# It is at the very top on purpose: bash reads ahead in chunks, so the fewer
# bytes there are between the reset and the exec, the smaller the window in
# which a buffered read can straddle the rewrite. Here the exec is inside
# the first chunk bash has already buffered, which closes it in practice.
#
# The phase is carried in the ENVIRONMENT rather than in an argument, so it
# cannot collide with `--no-pull` or with anything a caller passes.
#
# ⚠️ A COPY IS NOT A FIX. The conductor tried running a copy from /tmp and
# got `fatal: not a git repository`, correctly: this script derives its repo
# root from its own location. The file must stay where it is; what must not
# happen is reading it while it is being replaced.
# ==========================================================================
if [ "${DEPLOY_SWAP_PHASE:-fetch}" = "fetch" ]; then
  if [ "${1:-}" != "--no-pull" ]; then
    printf '\n\033[1m==> fetching origin/main, then re-executing the fetched script\033[0m\n'
    git fetch origin
    git reset --hard origin/main
  fi
  DEPLOY_SWAP_PHASE=run exec "$ROOT/scripts/deploy-swap.sh" "$@"
fi

# ==========================================================================
# ONE DEPLOY AT A TIME. THIS SCRIPT HAD NO LOCK AND FOUR LANES RUN IT.
#
# Everything below operates on ONE shared `.next-staging`: it `rm -rf`s the
# directory, builds into it, asserts four artifacts, and renames it over the
# live build. Two concurrent runs share every one of those steps.
#
# MEASURED, 2026-08-19: a deploy died with
#   ENOENT: no such file or directory,
#   open '/opt/onlysource/.next-staging/server/pages-manifest.json'
# while another lane's deploy of the same commit succeeded moments later. The
# second run's `rm -rf "$STAGING"` deleted the first run's build out from under
# it. That is the BENIGN outcome: it failed loudly and the swap never happened.
#
# THE OUTCOME WORTH FEARING IS THE QUIET ONE. If run A finishes its build while
# run B is midway through writing the same directory, run A's artifact gate
# checks FOUR named files and then renames a directory that is a mixture of two
# builds into place. Four files existing is not four files agreeing, and a
# half-swapped `.next` serves a chunk graph that no single commit ever produced.
#
# So the whole run takes an exclusive lock and a second caller is TOLD, not
# queued. Queueing would be worse here: a lane that waits ten minutes and then
# deploys is deploying a tree it read ten minutes ago, and the operator has
# usually moved on. Failing immediately with the holder's pid keeps the
# who-is-deploying question answerable.
#
# The lock is taken AFTER the re-exec, deliberately: the fetch phase replaces
# this file on disk, and a lock held across an `exec` of a rewritten script is
# a lock whose holder no longer exists in the form that took it.
#
# `9` is an arbitrary free descriptor; the lock file lives beside the build it
# guards so it cannot outlive a rebuilt box.
# ==========================================================================
LOCKFILE="${DEPLOY_SWAP_LOCK:-/tmp/onlysource-deploy-swap.lock}"

# ⚠️ `flock` IS LINUX. macOS DOES NOT SHIP IT, AND `! flock` SUCCEEDS WHEN THE COMMAND IS ABSENT.
#
# Written without this check, the guard read `if ! flock -n 9; then refuse`. On the droplet, which
# has util-linux flock, that is correct. On a Mac it means EVERY deploy is refused with "another
# deploy is already running" — a false statement about the state of the world, produced by a
# missing binary, in the exact words of the real condition.
#
# My own positive control caught it and I nearly misread the result: the test refused a second
# caller, which is what I was hoping to see, and it also refused the FIRST caller and the one after
# the lock released. Three refusals is not a working lock, it is a missing command. A guard that
# fails closed is the right direction to fail in and still has to fail for the stated reason.
if ! command -v flock >/dev/null 2>&1; then
  printf '\n\033[31mFAILED: flock is not installed, so concurrent deploys cannot be prevented.\033[0m\n' >&2
  printf 'This script is meant to run on the droplet, which has it. Refusing rather than\n' >&2
  printf 'deploying unguarded: two lanes sharing one .next-staging is how a half-built tree\n' >&2
  printf 'gets renamed over a working one. Override only if you are certain you are alone:\n' >&2
  printf '  DEPLOY_SWAP_NO_LOCK=1 %s\n' "$0" >&2
  [ "${DEPLOY_SWAP_NO_LOCK:-0}" = "1" ] || exit 1
  printf '\033[33mproceeding without a lock because DEPLOY_SWAP_NO_LOCK=1\033[0m\n' >&2
else
  # ⚠️ `>>` AND NOT `>`. Opening with `>` TRUNCATES BEFORE flock IS EVEN CONSULTED, so the second
  # caller wipes the holder's pid on its way to discovering that it is the second caller, and then
  # reads back the empty file it just created. My own control caught this: the refusal fired
  # correctly and printed no pid, because the pid had been erased a microsecond earlier by the
  # process complaining about its absence. Append-open takes the descriptor without touching the
  # contents; the pid is written after the lock is held, when truncating is safe.
  exec 9>>"$LOCKFILE" || { printf '\n\033[31mFAILED: cannot open %s\033[0m\n' "$LOCKFILE" >&2; exit 1; }
  if ! flock -n 9; then
    holder="$(cat "$LOCKFILE" 2>/dev/null | tr -d '[:space:]')"
    printf '\n\033[31mFAILED: another deploy is already running%s\033[0m\n' \
      "${holder:+ (pid $holder)}" >&2
    printf 'Nothing was changed. Wait for it to finish, then check /api/health for the commit it lands.\n' >&2
    exit 1
  fi
  printf '%s\n' "$$" > "$LOCKFILE"
fi

STAGING="${NEXT_DIST_DIR_STAGING:-.next-staging}"
LIVE=".next"
PREVIOUS=".next-previous"
APP="${PM2_APP:-onlysource}"
ORIGIN="${VERIFY_ORIGIN:-http://127.0.0.1:3000}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

# The fetch already happened in the phase above, before this process existed. Doing it again
# here would re-introduce exactly the hazard the re-exec closes.
TARGET_SHA="$(git rev-parse --short=8 HEAD)"
say "deploying $TARGET_SHA"

say "building into $STAGING (the live $LIVE is untouched and still serving)"
rm -rf "$STAGING"
NEXT_DIST_DIR="$STAGING" npm run build

# --------------------------------------------------------------------------
# THE ARTIFACT GATE. These are the two files whose absence took /enter down.
# A build that exits 0 without them is a build that cannot serve its entry point.
# --------------------------------------------------------------------------
say "asserting the build can actually serve its entry point"
REQUIRED=(
  "$STAGING/server/app/(auth)/enter/page.js"
  "$STAGING/server/app/(auth)/enter/page_client-reference-manifest.js"
  "$STAGING/server/pages/500.html"
  "$STAGING/BUILD_ID"
)
for f in "${REQUIRED[@]}"; do
  [ -s "$f" ] || die "build produced no $f. It exited 0 and cannot serve /enter. NOT swapping; $LIVE is untouched and still serving the previous build."
  printf '   ok  %s\n' "$f"
done

# Every route with a page must have carried its manifest through, not just /enter.
MISSING_MANIFESTS=0
while IFS= read -r pagejs; do
  d="$(dirname "$pagejs")"
  [ -s "$d/page_client-reference-manifest.js" ] || { printf '   MISSING manifest for %s\n' "$d"; MISSING_MANIFESTS=$((MISSING_MANIFESTS+1)); }
done < <(find "$STAGING/server/app" -name page.js 2>/dev/null)
[ "$MISSING_MANIFESTS" -eq 0 ] || die "$MISSING_MANIFESTS route(s) built without a client reference manifest. NOT swapping."

say "swapping (rename is atomic on one filesystem; this is the whole outage window)"
rm -rf "$PREVIOUS"
[ -d "$LIVE" ] && mv "$LIVE" "$PREVIOUS"
mv "$STAGING" "$LIVE"

say "restarting $APP"
pm2 restart "$APP" --update-env >/dev/null

rollback() {
  printf '\n\033[31mrolling back to the previous build\033[0m\n' >&2
  [ -d "$PREVIOUS" ] || { printf 'no %s to roll back to\n' "$PREVIOUS" >&2; return; }
  rm -rf "$LIVE"; mv "$PREVIOUS" "$LIVE"; pm2 restart "$APP" --update-env >/dev/null
  printf 'rolled back. Verify by hand before doing anything else.\n' >&2
}

say "verifying the deployed commit and the route that was breaking"
ok=0
for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$ORIGIN/enter" || true)"
  live="$(curl -s --max-time 10 "$ORIGIN/api/health" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' || true)"
  if [ "$code" = "200" ] && [ "$live" = "$TARGET_SHA" ]; then ok=1; break; fi
  sleep 2
done
if [ "$ok" != "1" ]; then
  printf 'after 60s: /enter=%s health=%s expected=%s\n' "${code:-none}" "${live:-none}" "$TARGET_SHA" >&2
  rollback
  die "the new build did not come up serving /enter at $TARGET_SHA"
fi

# --------------------------------------------------------------------------
# WARM THE COLD BUILD, AND SMOKE THE SIGNED-IN ROUTES WHILE DOING IT.
#
# MEASURED 2026-08-19: /monopoly takes 11.3 seconds on the FIRST request after a
# deploy and 1.7 seconds on every one after it. /pricing shows the same signature,
# 4.55s then 1.83s. The pages are not slow; the first visitor pays to build the
# scored set, and the memo is per-process so a restart throws it away.
#
# We deploy constantly. That first visitor is whoever opens the product next, which
# on any given night is the owner or a customer, on the flagship, seconds after a
# promote. THIS TURNS AN ELEVEN-SECOND VISITOR INTO AN ELEVEN-SECOND DEPLOY STEP.
#
# ★ AND IT IS THE FIRST SIGNED-IN CHECK THIS DEPLOY HAS EVER HAD. Everything above
# is anonymous, and an anonymous caller gets a 307 from every app route, so a page
# that 500s for a signed-in operator passes the entire protocol. That is not
# hypothetical: /monopoly and /pricing were both measured at 500 signed-in during a
# promote window while every anonymous check stayed green.
#
# The cookie is minted ON THIS BOX so the signing secret never leaves it. If minting
# is unavailable the deploy does NOT fail: an un-warmed deploy is a slow first visit,
# not a broken one, and refusing to finish over it would be a gate that costs more
# than the defect. A route that ANSWERS BADLY is a different matter and fails.
# --------------------------------------------------------------------------
WARM_ROUTES="${WARM_ROUTES:-/monopoly /board /pricing /suppliers /intelligence /}"

# ★ THE DURABLE MINT FIRST, THE LEGACY ONE SECOND, AND IT SAYS WHICH IT USED.
#
# The first version of this step hardcoded /tmp/mint.js and skipped on the very first deploy that
# reached it, because the droplet had rebooted and /tmp was wiped. It said so and finished, which
# was the right calibration and is why this is a two-minute correction rather than a warm that
# silently never ran. But a session minter living in /tmp is a control with a reboot in it.
#
# So the repo copy is preferred and the /tmp path is kept as a fallback rather than replaced,
# because these two land in separate commits and neither of us controls the order. Whichever
# exists is used, and the run PRINTS WHICH, so a future reader never has to guess which minter
# produced the session a deploy was verified with.
MINT=""
for candidate in "${MINT_SCRIPT:-}" "$ROOT/scripts/mint-gate.mjs" /tmp/mint.js; do
  if [ -n "$candidate" ] && [ -r "$candidate" ]; then MINT="$candidate"; break; fi
done

if [ -n "$MINT" ]; then
  say "warming the new build and smoking it signed in (session from $MINT)"
  WARM_COOKIE="__Host-os_gate=$(node "$MINT" deploy:warm 2>/dev/null || true)"
  if [ "$WARM_COOKIE" = "__Host-os_gate=" ]; then
    printf '   could not mint a session; skipping the warm. First visitor will pay the cold build.\n'
  else
    warm_failed=""
    for r in $WARM_ROUTES; do
      t0=$(date +%s%N)
      # `|| true` not `|| echo 000`: curl already prints 000 on a connection failure, and
      # appending another would report "000000", which reads like a status nobody can look up.
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 120 -H "cookie: $WARM_COOKIE" "$ORIGIN$r" || true)"
      code="${code:-000}"
      ms=$(( ($(date +%s%N) - t0) / 1000000 ))
      printf '   %-14s %s  %6s ms\n' "$r" "$code" "$ms"
      # 200 or a redirect are both fine; a 5xx or a failed connection is not.
      case "$code" in 2*|3*) ;; *) warm_failed="$warm_failed $r($code)" ;; esac
    done
    if [ -n "$warm_failed" ]; then
      printf '\n   signed-in smoke FAILED on:%s\n' "$warm_failed" >&2
      rollback
      die "the new build serves anonymous callers but fails signed in. Rolled back."
    fi
    say "warm: every route above was served once, so the first real visitor does not build the cache"
  fi
else
  printf '\n   no session minter found (tried $MINT_SCRIPT, scripts/mint-gate.mjs, /tmp/mint.js);\n   skipping the warm AND the signed-in smoke. First visitor will pay the cold build.\n' 
fi

say "LIVE: $TARGET_SHA · /enter 200 · previous build kept at $PREVIOUS"
echo "roll back with:  rm -rf $LIVE && mv $PREVIOUS $LIVE && pm2 restart $APP"
