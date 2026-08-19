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
MINT="${MINT_SCRIPT:-/tmp/mint.js}"

if [ -r "$MINT" ]; then
  say "warming the new build and smoking it signed in"
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
  printf '\n   no %s on this host; skipping the warm. First visitor will pay the cold build.\n' "$MINT"
fi

say "LIVE: $TARGET_SHA · /enter 200 · previous build kept at $PREVIOUS"
echo "roll back with:  rm -rf $LIVE && mv $PREVIOUS $LIVE && pm2 restart $APP"
