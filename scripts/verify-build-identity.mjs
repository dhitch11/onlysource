#!/usr/bin/env node
/**
 * POST-DEPLOY SMOKE CHECK: does the live site report the commit that was just shipped?
 *
 * Run it as the last step of every promote:
 *
 *     node scripts/verify-build-identity.mjs https://206.189.230.237.nip.io
 *
 * Exit 0 when /api/health reports exactly the local HEAD. Exit 1 on any other answer,
 * including "commit: null", a short-vs-short mismatch, or an unreachable endpoint. It
 * exists because the live badge reported a commit 52 deploys old while newer code served
 * (audit 2026-08-17): a deploy that cannot prove its own identity is not finished.
 *
 * No secrets involved: /api/health's base tier is public liveness data.
 */
import { execSync } from 'node:child_process'

const origin = process.argv[2]
if (!origin) {
  console.error('usage: node scripts/verify-build-identity.mjs <origin, e.g. https://host>')
  process.exit(1)
}

const local = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'inherit'] })
  .toString()
  .trim()

let body
try {
  const resp = await fetch(new URL('/api/health', origin), {
    signal: AbortSignal.timeout(15_000),
  })
  body = await resp.json()
} catch (e) {
  console.error(`FAIL: could not read ${origin}/api/health: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
}

const reported = typeof body.commit === 'string' ? body.commit : null
if (!reported) {
  console.error(`FAIL: live health reports no commit (commitSource=${body.commitSource ?? 'null'}).`)
  process.exit(1)
}
if (!local.startsWith(reported)) {
  console.error(
    `FAIL: live is serving ${reported} (source ${body.commitSource ?? '?'}), local HEAD is ${local.slice(0, 8)}. ` +
      'The deploy did not land, or the identity stamp is stale.',
  )
  process.exit(1)
}
console.log(`OK: live reports ${reported} (source ${body.commitSource ?? '?'}), matching HEAD ${local.slice(0, 8)}.`)
