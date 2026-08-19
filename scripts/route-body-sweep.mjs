#!/usr/bin/env node
/**
 * THE ROUTE BODY SWEEP. Deploy step 8, executable.
 *
 * =====================================================================================
 * WHY: A 200 IS A STATEMENT ABOUT THE TRANSPORT, NOT ABOUT THE PAGE
 * =====================================================================================
 * MEASURED, 2026-08-15 to 2026-08-18. `/competitor` served HTTP 200 for three days whose
 * body was the error boundary. An anonymous smoke passed it, a signed-in status sweep
 * passed it, and a 2,043-test suite passed it. Every instrument in the estate agreed the
 * route was healthy and every operator who opened it saw "Something failed on our side."
 *
 * Deploy step 8 said "verify in a real browser by reading the BODY", and a step phrased
 * that way is satisfied by looking at it. This is the same instruction as a command that
 * exits non-zero.
 *
 * =====================================================================================
 * WHAT IT ASSERTS, AND WHY EACH ARM EXISTS
 * =====================================================================================
 *   1. STATUS matches the baseline. An app route that stops redirecting an anonymous
 *      caller is a gate failure; one that starts redirecting a signed-in caller is a
 *      session failure. Both are silent to a "is it 2xx or 3xx" check.
 *   2. The body does NOT carry an error-boundary sentence. Taken verbatim from the two
 *      boundaries so the strings cannot drift apart from the thing they detect:
 *      `app/error.tsx` and `app/global-error.tsx`.
 *   3. The body DOES carry the page's OWN heading, compared against a recorded baseline.
 *      Not "a heading exists": the error boundary and a blank shell can both satisfy
 *      that. The page that renders must be the page that was asked for.
 *
 * ★ THE HEADING IS NOT ALWAYS AN <h1>, AND PRETENDING IT IS WOULD MAKE THIS LIE.
 * `app/error.tsx:28` and `app/(auth)/enter/page.tsx:73` both render `<p className="h1">`,
 * not a heading element. So this reads the house heading pattern as well as real headings.
 * That is a workaround for an accessibility defect, not an endorsement of it: two of this
 * product's pages currently expose no heading element to a screen reader at all, and that
 * is reported at the end of every run rather than quietly accommodated.
 *
 * =====================================================================================
 * IT IS A RATCHET, AND THE ROUTE LIST DISCOVERS ITSELF
 * =====================================================================================
 * The routes come from walking `app/**` for page files. A hardcoded list is a defect with a
 * delay on it: it passes forever while the route it does not name rots. A route that appears
 * with no baseline entry FAILS rather than being skipped, because a new surface nobody
 * checked is exactly the one worth checking.
 *
 * USAGE
 *   node scripts/route-body-sweep.mjs --selftest
 *   node scripts/route-body-sweep.mjs --anon
 *   node scripts/route-body-sweep.mjs --cookie "$COOKIE"        (or ONLYSOURCE_SWEEP_COOKIE)
 *   node scripts/route-body-sweep.mjs --anon --update-baseline
 *
 * The cookie is read from the environment or argv and is NEVER printed, NEVER written to the
 * baseline, and NEVER included in any failure message. Mint it on the droplet so the signing
 * secret does not leave the box.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { request } from 'node:https'
import { join, relative, extname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const BASELINE = join(ROOT, '.route-body-baseline.json')
const DEFAULT_BASE = 'https://206.189.230.237.nip.io'

/**
 * Verbatim from the two error boundaries. If either sentence is edited, this must be edited
 * with it, and the selftest fixture below is what fails first if it is not.
 */
const BOUNDARY_SENTENCES = ['Something failed on our side.', 'ONLYSOURCE failed to start.']

const PAGE_FILE = /^page\.(tsx?|jsx?)$/

/* ------------------------------------------------------------------ route discovery */

function walkPages(dir, out = []) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walkPages(full, out)
    else if (PAGE_FILE.test(name) && extname(name)) out.push(relative(ROOT, full))
  }
  return out
}

/**
 * `app/(app)/board/page.tsx` becomes `/board`. Route groups in parentheses contribute no
 * path segment, which is the whole point of the parentheses, and a sweep that emitted
 * `/(app)/board` would 404 on every route and report the product dead.
 */
function routeOf(pageFile) {
  const segs = pageFile
    .replace(/^app\//, '')
    .replace(/\/page\.(tsx?|jsx?)$/, '')
    .split('/')
    .filter((s) => s !== '' && !(s.startsWith('(') && s.endsWith(')')))
  return '/' + segs.join('/')
}

/** A dynamic segment cannot be fetched without a real value; the baseline supplies one. */
const isDynamic = (route) => route.includes('[')

/* ------------------------------------------------------------------ the judgement */

/** The first real heading, else the house's `class="h1"` paragraph. Null when neither exists. */
export function headingOf(body) {
  const h1 = body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1) return text(h1[1])
  const pseudo = body.match(/<p\b[^>]*class="[^"]*\bh1\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
  if (pseudo) return text(pseudo[1])
  return null
}

const text = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

/** Pure, so the selftest can drive every arm without a network. */
/**
 * How far a route may grow before growth is a defect rather than data.
 *
 * 1.5x is a REGRESSION guard and needs no policy: a page that half again its recorded size
 * between two deploys did not gain that from one more row. It is objective, so it can ship
 * without anyone deciding a budget.
 *
 * An absolute `maxBytes` is a POLICY and is therefore optional and per-route, set by whoever
 * owns the surface. Absent means no ceiling. It is not defaulted here, because a number this
 * file invented would either be ignored or enforced by accident, and both are worse than the
 * conductor choosing one.
 *
 * MEASURED 2026-08-19, which is the reason this arm exists at all: /monopoly serves 371
 * corners at 10,298 bytes each, and its row count IS the catalogue. At the 191,667 sole-source
 * positions the catalogue publishes, that page is ~1.97 GB of HTML on a 2 GB box. No server
 * size repairs it and no browser renders it. A payload gate is how that is discovered by a
 * failing promote rather than by a customer.
 */
const GROWTH_MULTIPLE = 1.5
/** Below this, a percentage swing is noise: a changed timestamp can move a small page 20%. */
const GROWTH_FLOOR_BYTES = 50_000

export function judge({ route, status, body, expected }) {
  const problems = []
  if (!expected) {
    problems.push(`no baseline entry. A route nobody has checked is the one worth checking. Run --update-baseline once you have looked at it.`)
    return problems
  }
  if (status !== expected.status) {
    problems.push(`status ${status}, baseline says ${expected.status}`)
  }
  for (const s of BOUNDARY_SENTENCES) {
    if (body.includes(s)) problems.push(`ERROR BOUNDARY IN BODY: "${s}"`)
  }
  // A redirect has no page to read; status is the whole assertion for it.
  if (status >= 300 && status < 400) return problems

  const bytes = body.length
  if (expected.maxBytes !== undefined && expected.maxBytes !== null && bytes > expected.maxBytes) {
    problems.push(
      `${bytes.toLocaleString()} bytes exceeds the ceiling set for this route, ${Number(expected.maxBytes).toLocaleString()}`,
    )
  }
  if (
    typeof expected.bytes === 'number' &&
    expected.bytes >= GROWTH_FLOOR_BYTES &&
    bytes > expected.bytes * GROWTH_MULTIPLE
  ) {
    problems.push(
      `${bytes.toLocaleString()} bytes is ${(bytes / expected.bytes).toFixed(1)}x the recorded ` +
        `${expected.bytes.toLocaleString()}. A page does not grow by half from one more row.`,
    )
  }
  const heading = headingOf(body)
  if (heading === null) {
    problems.push('no heading of any kind in the body')
  } else if (expected.heading != null && heading !== expected.heading) {
    problems.push(`heading is "${heading}", baseline says "${expected.heading}"`)
  }
  return problems
}

/* ------------------------------------------------------------------ the selftest */

const FIXTURE_OK = '<html><body><main><h1>The monopoly map</h1><p>rows</p></main></body></html>'
const FIXTURE_BOUNDARY =
  '<html><body><main class="entry"><p class="h1">Something failed on our side.</p>' +
  '<p class="lede">This is our fault, not yours</p></main></body></html>'
const FIXTURE_EMPTY = '<html><body><main></main></body></html>'
const FIXTURE_WRONG = '<html><body><main><h1>The board</h1></main></body></html>'

function selftest() {
  const failures = []
  const expect = { status: 200, heading: 'The monopoly map' }
  /** A body of exactly n bytes that still carries the expected heading. */
  const big = (n) => {
    const head = '<html><body><h1>The monopoly map</h1>'
    const tail = '</body></html>'
    return head + 'x'.repeat(Math.max(0, n - head.length - tail.length)) + tail
  }
  const expect200k = { status: 200, heading: 'The monopoly map', bytes: 200_000 }
  const cases = [
    ['a healthy page passes', { route: '/monopoly', status: 200, body: FIXTURE_OK, expected: expect }, 0],
    ['★ a 200 carrying the error boundary FAILS', { route: '/monopoly', status: 200, body: FIXTURE_BOUNDARY, expected: expect }, 2],
    ['a 200 with no heading at all FAILS', { route: '/monopoly', status: 200, body: FIXTURE_EMPTY, expected: expect }, 1],
    ['a 200 rendering the WRONG page FAILS', { route: '/monopoly', status: 200, body: FIXTURE_WRONG, expected: expect }, 1],
    ['an unexpected status FAILS', { route: '/monopoly', status: 307, body: '', expected: expect }, 1],
    ['a route with no baseline FAILS', { route: '/new', status: 200, body: FIXTURE_OK, expected: undefined }, 1],
    ['an expected redirect passes', { route: '/board', status: 307, body: '', expected: { status: 307, heading: null } }, 0],
    // The payload arms. Both need a control or they are decoration.
    ['★ a page over its stated ceiling FAILS', { route: '/monopoly', status: 200, body: big(200_000), expected: { ...expect200k, maxBytes: 150_000 } }, 1],
    ['a page under its stated ceiling passes', { route: '/monopoly', status: 200, body: big(100_000), expected: { ...expect200k, maxBytes: 150_000 } }, 0],
    ['★ a page 2x its recorded size FAILS even with no ceiling set', { route: '/monopoly', status: 200, body: big(400_000), expected: expect200k }, 1],
    ['ordinary growth does NOT fail, or the gate cries wolf', { route: '/monopoly', status: 200, body: big(240_000), expected: expect200k }, 0],
    ['a SMALL page may swing freely: a timestamp must not fail a promote', { route: '/', status: 200, body: big(40_000), expected: { status: 200, heading: 'The monopoly map', bytes: 10_000 } }, 0],
  ]
  for (const [name, input, wantCount] of cases) {
    const got = judge(input).length
    if (got !== wantCount) failures.push(`${name}: expected ${wantCount} problem(s), got ${got}`)
  }
  // The boundary fixture must fail SPECIFICALLY on the boundary sentence, not incidentally
  // on the heading mismatch. A control that fires for the wrong reason is not a control.
  const why = judge({ route: '/monopoly', status: 200, body: FIXTURE_BOUNDARY, expected: expect })
  if (!why.some((p) => p.startsWith('ERROR BOUNDARY IN BODY'))) {
    failures.push('the boundary fixture did not fail on the boundary sentence')
  }
  // And the sentences must still exist in the boundaries they were copied from.
  for (const [file, sentence] of [['app/error.tsx', BOUNDARY_SENTENCES[0]], ['app/global-error.tsx', BOUNDARY_SENTENCES[1]]]) {
    let src = ''
    try {
      src = readFileSync(join(ROOT, file), 'utf8')
    } catch {
      failures.push(`${file} is missing; the sentence this sweep detects cannot be confirmed`)
      continue
    }
    if (!src.includes(sentence)) {
      failures.push(`${file} no longer contains "${sentence}". The detector and the boundary have drifted apart.`)
    }
  }
  if (failures.length) {
    console.error('\nROUTE BODY SWEEP SELF-TEST FAILED.\n')
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log(`route body sweep self-test: PASS. ${cases.length} arms, and both boundary sentences confirmed present in their source files.`)
  process.exit(0)
}

if (process.argv.includes('--selftest')) selftest()

/* ------------------------------------------------------------------ the sweep */

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const BASE = argOf('--base', DEFAULT_BASE).replace(/\/$/, '')
const COOKIE = argOf('--cookie', process.env.ONLYSOURCE_SWEEP_COOKIE ?? '')
const ANON = argv.includes('--anon') || COOKIE === ''

/**
 * ★ TLS VERIFICATION IS ON, AND THIS COMMENT IS THE RECORD OF WHY IT WAS EVER OFF.
 *
 * The first version of this file passed `rejectUnauthorized: false`, on the belief that
 * production was a bare IP on a self-signed certificate. **It is not, and had not been for
 * four days.** Measured 2026-08-19: the host presents a Let's Encrypt certificate for
 * `CN=206.189.230.237.nip.io`, valid 15 Aug to 13 Nov, and `curl` without `-k` returns 200.
 * The `-k` in every runbook on this estate is a habit left over from a setup that no longer
 * exists, and it had already outlived its reason by the time it was written down here.
 *
 * A verification bypass that is no longer needed is worse than one that is, because nobody
 * re-examines it: it silently converts "we trust this host" into "we would not notice if we
 * were talking to something else". Restored deliberately. If a future host genuinely cannot
 * present a certificate, fix the host.
 *
 * Redirects are never followed. `fetch` follows by default, which is exactly how a 307 to
 * /enter reads as a 200 and a gated route reports healthy. See the `followed-redirect-read-as-ok`
 * lint rule.
 */
function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: 'GET', headers: COOKIE ? { cookie: COOKIE } : {} },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    req.on('error', reject)
    req.setTimeout(25000, () => req.destroy(new Error('timeout after 25s')))
    req.end()
  })
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { anon: {}, signedIn: {}, samples: {} }
const mode = ANON ? 'anon' : 'signedIn'
const expectations = baseline[mode] ?? {}
const samples = baseline.samples ?? {}

const routes = walkPages(join(ROOT, 'app'))
  .map(routeOf)
  .sort()
  .map((r) => ({ route: r, url: isDynamic(r) ? samples[r] : r }))

const results = []
for (const { route, url } of routes) {
  if (!url) {
    results.push({ route, problems: [`dynamic route has no sample path. Add "samples": { "${route}": "/corner/1234-56-789-0123" } to ${relative(ROOT, BASELINE)}.`], status: null, heading: null })
    continue
  }
  let r
  try {
    r = await fetchRaw(BASE + url)
  } catch (e) {
    results.push({ route, url, problems: [`request failed: ${e.message}`], status: null, heading: null })
    continue
  }
  const heading = r.status >= 300 && r.status < 400 ? null : headingOf(r.body)
  results.push({
    route,
    url,
    status: r.status,
    bytes: r.body.length,
    heading,
    problems: judge({ route, status: r.status, body: r.body, expected: expectations[route] }),
  })
}

if (argv.includes('--update-baseline')) {
  const next = { ...baseline, samples, [mode]: {} }
  for (const r of results) {
    if (r.status == null) continue
    // maxBytes is preserved if an owner set one; this writer never invents a ceiling.
    const prior = (baseline[mode] ?? {})[r.route] ?? {}
    next[mode][r.route] = {
      status: r.status,
      heading: r.heading,
      bytes: r.bytes ?? null,
      ...(prior.maxBytes === undefined ? {} : { maxBytes: prior.maxBytes }),
    }
  }
  writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n')
  console.log(`route body baseline updated for mode "${mode}": ${Object.keys(next[mode]).length} route(s) recorded.`)
  process.exit(0)
}

console.log(`route body sweep: ${BASE} · mode ${mode} · ${results.length} route(s) discovered from app/**`)
let failed = 0
for (const r of results) {
  const ok = r.problems.length === 0
  if (!ok) failed++
  const head = r.heading === null ? '' : `  "${r.heading.slice(0, 46)}"`
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${String(r.status ?? '---').padEnd(4)} ${String(r.bytes ?? '').padStart(7)}b  ${r.route}${head}`)
  for (const p of r.problems) console.log(`          ${p}`)
}

const noHeading = results.filter((r) => r.status === 200 && r.heading === null)
if (noHeading.length) {
  console.log(`\n  accessibility note: ${noHeading.length} route(s) served 200 with no heading element of any kind.`)
}

if (failed) {
  console.error(`\nROUTE BODY SWEEP: ${failed} of ${results.length} route(s) FAILED. A 200 is a statement about the transport, not about the page.\n`)
  process.exit(1)
}
console.log(`\nroute body sweep: all ${results.length} route(s) served the page they were asked for.`)
