#!/usr/bin/env node
/**
 * R0.2 — SECRET SCAN ON THE DIFF, PLUS THE CREDENTIAL CANARY.
 *
 * Referenced by `npm run gate:r0` and `gate:r0:secrets` since early in the build. The file
 * did not exist, so both commands died on a missing module and no diff was ever scanned.
 *
 * =====================================================================================
 * WHY THE DIFF AND NOT THE TREE
 * =====================================================================================
 * A tree scan on a repo with a real history is all noise: every historical false positive
 * is re-reported on every run, the output gets skimmed, and the one real key lands in the
 * middle of it unread. The diff is the only surface where a NEW secret can arrive, and a
 * gate people actually read is worth more than a gate that is technically thorough.
 *
 * `--all` scans the whole working tree for when you want the audit rather than the gate.
 *
 * =====================================================================================
 * TWO CHECKS, AND THE SECOND IS THE ONE PEOPLE FORGET
 * =====================================================================================
 * 1. PATTERN SCAN: known key shapes, plus a generic high-entropy assignment to a name that
 *    means secret. Detectors are listed with what they are for, so a hit is actionable
 *    rather than "line 40 matched a regex".
 *
 * 2. ★ THE CANARY (the part that catches the leak a pattern scan cannot). A secret does not
 *    only leak by being committed. It leaks by being LOGGED, traced, or included in a
 *    request body to a third party. R0.2 asks for the literal canary value to be absent
 *    from every log sink, APM trace and recorded model request. So: put a known sentinel in
 *    the environment as ONLYSOURCE_CANARY, exercise the app, and assert the sentinel appears
 *    in no artifact. If the canary is not configured this check reports NOT CONFIGURED and
 *    says so loudly, because a check that silently skips is indistinguishable from a check
 *    that passes — and this estate has shipped several of exactly that.
 *
 * A NOTE ON WHAT THIS CANNOT DO: it reads text. A secret that arrives base64'd inside a
 * blob, or is assembled from parts at runtime, will pass. This gate raises the floor; it is
 * not a proof of absence, and it must never be described as one.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

/* ---------------------------------------------------------------- the detectors */

const DETECTORS = [
  { id: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/, what: 'an Anthropic API key' },
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9]{32,}\b/, what: 'an OpenAI-style API key' },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, what: 'an AWS access key id' },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, what: 'a GitHub token' },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/, what: 'a Slack token' },
  { id: 'google-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, what: 'a Google API key' },
  { id: 'stripe-key', re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/, what: 'a Stripe key' },
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, what: 'a private key block' },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, what: 'a signed JWT' },
  { id: 'postgres-url-with-password', re: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@/, what: 'a database URL carrying a password' },
  {
    id: 'assigned-secret-literal',
    /*
     * A long opaque literal assigned to a name that means secret. Deliberately requires 20+
     * chars with mixed classes: the shorter and simpler the literal, the more likely it is a
     * placeholder, an example, or a test fixture, and a noisy detector gets the whole gate
     * switched off.
     */
    re: /\b(?:api[_-]?key|secret|password|passwd|token|credential|private[_-]?key)\b\s*[:=]\s*['"`]([A-Za-z0-9+/_-]{20,})['"`]/i,
    what: 'a literal assigned to a secret-shaped name',
    // Obvious non-secrets. Kept tight, because every entry here is a hole.
    ignore: /example|placeholder|redacted|dummy|fake|your[_-]?key|xxxx|\.\.\.|process\.env|<[^>]+>/i,
  },
]

/** Paths whose contents are not source we control, or are deliberately synthetic. */
const SKIP_PATH =
  /(^|\/)(node_modules|\.next|\.git|dist|build|coverage|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)(\/|$)/

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.xlsx', '.xls',
  '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.mp3', '.db', '.sqlite',
])

function scanText(path, text) {
  const out = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > 2000) continue // minified or data; not reviewable source
    for (const d of DETECTORS) {
      const m = line.match(d.re)
      if (!m) continue
      if (d.ignore && d.ignore.test(line)) continue
      out.push({
        path,
        line: i + 1,
        id: d.id,
        what: d.what,
        // Never print the secret. Show enough to locate it and nothing more.
        excerpt: `${m[0].slice(0, 4)}…${m[0].slice(-2)} (${m[0].length} chars)`,
      })
    }
  }
  return out
}

/* ---------------------------------------------------------------- what to scan */

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/** Files changed vs HEAD, staged or not, plus untracked. The surface a new secret arrives on. */
function changedFiles() {
  const set = new Set()
  try {
    for (const f of git(['diff', '--name-only', 'HEAD']).split('\n')) if (f.trim()) set.add(f.trim())
    for (const f of git(['ls-files', '--others', '--exclude-standard']).split('\n')) {
      if (f.trim()) set.add(f.trim())
    }
  } catch {
    return null // not a git repo, or no HEAD yet
  }
  return [...set]
}

function allFiles(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = relative(ROOT, full)
    if (SKIP_PATH.test(rel)) continue
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) allFiles(full, out)
    else out.push(rel)
  }
  return out
}

/* ---------------------------------------------------------------- the canary */

/**
 * R0.2's second half: the literal canary value must be absent from every artifact that
 * leaves the process. Reports NOT CONFIGURED rather than passing silently.
 */
function canaryCheck() {
  const canary = process.env.ONLYSOURCE_CANARY
  if (!canary || canary.length < 12) {
    console.log(
      'canary: NOT CONFIGURED. Set ONLYSOURCE_CANARY to a unique 12+ char sentinel, exercise\n' +
        '        the app, and this asserts the sentinel reaches no log, trace or request body.\n' +
        '        Reported rather than skipped: a check that silently passes is not a check.',
    )
    return { configured: false, leaks: [] }
  }
  const sinks = ['.probe', 'logs', '.next/trace', 'tmp'].map((d) => join(ROOT, d)).filter(existsSync)
  const leaks = []
  for (const sink of sinks) {
    for (const rel of allFiles(sink, [])) {
      const abs = join(ROOT, rel)
      if (BINARY_EXT.has(extname(rel))) continue
      let text
      try {
        text = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      if (text.includes(canary)) leaks.push(rel)
    }
  }
  console.log(
    leaks.length
      ? `canary: ${leaks.length} artifact(s) CONTAIN the canary value.`
      : `canary: configured, and absent from ${sinks.length} sink director${sinks.length === 1 ? 'y' : 'ies'}.`,
  )
  return { configured: true, leaks }
}

/* ---------------------------------------------------------------- main */

const scanAll = process.argv.includes('--all')
let files = scanAll ? allFiles() : changedFiles()
let scope = scanAll ? 'working tree' : 'diff vs HEAD + untracked'

if (files === null) {
  console.log('secret scan: not a git repository, falling back to a full tree scan.')
  files = allFiles()
  scope = 'working tree (no git)'
}

const findings = []
for (const rel of files) {
  if (SKIP_PATH.test(rel)) continue
  if (BINARY_EXT.has(extname(rel))) continue
  const abs = join(ROOT, rel)
  let text
  try {
    if (!statSync(abs).isFile()) continue
    text = readFileSync(abs, 'utf8')
  } catch {
    continue // deleted in the diff, or unreadable
  }
  findings.push(...scanText(rel, text))
}

console.log(`secret scan: ${DETECTORS.length} detectors over ${files.length} file(s) [${scope}].`)
const canary = canaryCheck()

if (findings.length === 0 && canary.leaks.length === 0) {
  console.log('secret scan: clean.')
  process.exit(0)
}

if (findings.length) {
  console.error(`\nSECRET SCAN: ${findings.length} finding(s).\n`)
  for (const f of findings) {
    console.error(`  ${f.path}:${f.line}  ${f.id} — ${f.what}`)
    console.error(`    ${f.excerpt}`)
  }
  console.error(
    '\n  If any of these is real: rotate it FIRST, then remove it. A key removed from a file\n' +
      '  it was already pushed in is still a live key.\n',
  )
}
if (canary.leaks.length) {
  console.error(`\nCANARY LEAK: the sentinel value appears in ${canary.leaks.length} artifact(s):\n`)
  for (const l of canary.leaks) console.error(`  ${l}`)
  console.error('\n  A real credential would take the same path out of the process.\n')
}
process.exit(1)
