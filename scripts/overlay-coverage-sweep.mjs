#!/usr/bin/env node
/**
 * DOES A FIXED OVERLAY SIT ON TOP OF ANYTHING YOU HAVE TO PRESS?
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------------------------
 * On 2026-08-19 several lanes made controls full-width on mobile, independently and correctly.
 * The floating Thomas launcher is fixed to the bottom-right, and it had never overlapped anything
 * because the controls underneath it were 88-133px wide and never reached that column. The moment
 * they became full-width they reached it, on every surface at once.
 *
 * Nobody introduced that defect. It was introduced by two correct changes meeting, which is the
 * kind that no single lane's review can catch and no single surface's fix can close. So this is a
 * sweep rather than a fix: the next lane that widens a control finds out from a gate.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT MEASURES, AND WHY NOT PERCENTAGE ALONE
 * ---------------------------------------------------------------------------------------------
 * A percentage of overlapped area is the obvious metric and it is the weaker one. 5px clipped from
 * the corner of a 214px button is 2.3% and nobody fails to press it; an overlay dead over the
 * middle of a small control is fatal at the same percentage. So the primary test is:
 *
 *      IS THE CONTROL'S OWN CENTRE POINT OCCLUDED?  `document.elementFromPoint` at that point
 *      returns what a finger would actually hit. That is the computed result, not a geometric
 *      guess about it.
 *
 * Area is kept as a secondary signal because a control can be reachable at its centre and still
 * be substantially buried, and because a trend is easier to see in a number than in a boolean.
 *
 * Text occlusion is reported separately: an overlay covering a sentence mid-word is a different
 * harm from one clipping a button, and it was the one that justified shrinking the launcher.
 *
 * ---------------------------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------------------------
 *   SWEEP_EMAIL=... SWEEP_PASSWORD=... node scripts/overlay-coverage-sweep.mjs [--base URL]
 *   node scripts/overlay-coverage-sweep.mjs --selftest
 *
 * Credentials come from the environment and are never written here. A sweep that cannot sign in
 * says so and exits non-zero rather than reporting a clean run over a wall of sign-in pages,
 * which is the failure mode that makes a green check worthless.
 */
import { chromium, devices } from 'playwright'
import { readdirSync, statSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = argValue('--base') ?? process.env.SWEEP_BASE ?? 'https://206.189.230.237.nip.io'
/*
 * HEIGHT IS A DIMENSION OF THIS TEST, NOT A DETAIL OF THE HARNESS.
 *
 * The launcher is anchored to the BOTTOM of the viewport while content is positioned by scroll, so
 * which control passes beneath it depends on how tall the viewport is. Two runs at the same width
 * and different heights produce different collision sets entirely.
 *
 * I learned this from a disagreement: @GAP-AUDIT reported the launcher at top 662 on /design where
 * I measured 786. Neither of us was wrong - 786 is a 844px viewport and 662 is a 720px one, and the
 * launcher sits 12px off the bottom of whichever it is in. A sweep fixed at one height cannot see
 * what the other height does.
 */
const PROFILES = [
  { width: 320, height: 667 },
  { width: 320, height: 844 },
  { width: 390, height: 844 },
]
/** Centre occluded is a failure on its own. Area is a failure only when it is most of the control. */
const AREA_FAIL_RATIO = 0.25
/**
 * WCAG 2.5.8 Target Size (Minimum), Level AA. A control drawn AT this size has no slack: any
 * overlay at all takes its usable area below the floor the standard sets.
 *
 * This is the rule that stops the sweep from arguing by percentage alone. 5px clipped off a 214px
 * button is 2.3% and the conductor was right that nobody fails to press it. The SAME launcher over
 * a 24px ExplainButton trigger is 34.8%, and the trigger is already at the minimum a standard
 * names, deliberately and with the citation in its stylesheet. A control with room to spare can
 * lend some; a control at the floor cannot lend any.
 */
const WCAG_MIN_TARGET_PX = 24
/*
 * ★ THE SWEEP MUST SCROLL, AND THIS IS THE WHOLE REASON.
 *
 * A `position: fixed` overlay sits on whatever is under it AT THE CURRENT SCROLL OFFSET. A run that
 * only ever samples scroll 0 is not measuring the page, it is measuring the top of the page - and on
 * a long route the top is exactly where the launcher floats over blank space. @GAP-AUDIT's own
 * overlap check reported ZERO on every route for precisely that reason.
 *
 * It also means a trailing gutter cannot fix this class: `padding-block-end` protects the LAST line
 * of the document and nothing in between. That was tried (88px on .content below 60rem, `0af877b`)
 * and measured not to help, because the obstructions are hundreds of pixels from the page end.
 *
 * ★★ AND DO NOT SAMPLE BY PIXELS EITHER. SOLVE FOR THE OFFSETS THAT CAN COLLIDE.
 *
 * Walking every pixel is unaffordable - /monopoly carries ~93,000px of scroll, over a hundred
 * viewports, and walking it took @GAP-AUDIT past 121 seconds before the run was killed. But evenly
 * spaced sampling is not merely cheaper, it is WRONG: it steps over things. My own selftest proved
 * it. A 3000px fixture whose control is obstructed at scroll ~1416, sampled at eight even offsets
 * over 2360px, is checked at 1349 and at 1686 and is reported CLEAN at both.
 *
 * So the offsets are COMPUTED, not guessed. A fixed overlay occupies a constant viewport box, and
 * every control has a known document position, so the scroll offsets at which a given control can
 * possibly sit under that overlay are arithmetic. Only controls whose HORIZONTAL band overlaps the
 * overlay's can ever collide, which prunes almost everything on a page whose overlay is a corner
 * launcher. What is left is O(controls that could collide), not O(page height), and it is exact
 * rather than statistical: nothing is stepped over, and the tallest page costs no more than a
 * short one with the same controls.
 */
const SAMPLES = Number(argValue('--samples') ?? 8)
const SETTLE_MS = 220
/** Per route-width. When it runs out the run says how many offsets it skipped; it never truncates quietly. */
const ROUTE_BUDGET_MS = 20000

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i > -1 ? process.argv[i + 1] : undefined
}

/**
 * The route list DISCOVERS ITSELF from the router. A hardcoded list is a defect with a delay on
 * it: it is correct until somebody adds a route, and then it is quietly incomplete forever.
 */
function discoverRoutes(root = 'app/(app)') {
  const out = []
  const walk = (dir, url) => {
    let entries
    try { entries = readdirSync(dir) } catch { return }
    if (entries.some((e) => /^page\.(tsx|jsx|ts|js)$/.test(e))) out.push(url || '/')
    for (const e of entries) {
      const p = join(dir, e)
      if (!statSync(p).isDirectory()) continue
      if (e.startsWith('_') || e === 'api') continue
      // A dynamic segment needs a value this sweep does not have. Reported, never silently dropped.
      if (e.startsWith('[')) { out.push({ skipped: `${url}/${e}`, why: 'dynamic segment, no value to supply' }); continue }
      // A route group's parentheses are not part of the URL.
      walk(p, e.startsWith('(') && e.endsWith(')') ? url : `${url}/${e}`)
    }
  }
  walk(root, '')
  return out
}

/** The probe, run inside the page. Returns findings, never a verdict. */
const PROBE = ([AREA_FAIL_RATIO, MIN_TARGET]) => {
  const visible = (e) => {
    const s = getComputedStyle(e)
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const describe = (e) => {
    const cls = (e.getAttribute('class') || '').trim().split(/\s+/)[0] || ''
    const t = (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30)
    return `${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}${t ? ` "${t}"` : ''}`
  }
  const all = [...document.querySelectorAll('body *')].filter(visible)
  /*
   * `fixed` and `sticky` are both overlays and they are NOT the same finding.
   *
   * A sticky table header passing over its own rows as you scroll is the entire point of a sticky
   * table header. Failing that would be failing the feature. A `fixed` element sits over whatever
   * happens to be beneath it and was never positioned with that content in mind, which is the
   * thing this sweep exists to catch. So both are measured, both are labelled, and only `fixed`
   * can fail the run.
   */
  const overlays = all.filter((e) => {
    const s = getComputedStyle(e)
    if (s.position !== 'fixed' && s.position !== 'sticky') return false
    const r = e.getBoundingClientRect()
    return r.width >= 16 && r.height >= 16
  })
  const kindOf = (e) => getComputedStyle(e).position
  if (!overlays.length) return { overlays: [], controls: 0, findings: [], textFindings: [] }

  const CONTROL = 'button,a,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="switch"]'
  const controls = all.filter((e) => e.matches(CONTROL) && !overlays.some((o) => o === e || o.contains(e)))
  const findings = []
  for (const c of controls) {
    const q = c.getBoundingClientRect()
    if (q.bottom < 0 || q.top > innerHeight || q.width === 0) continue
    for (const o of overlays) {
      const r = o.getBoundingClientRect()
      const ox = Math.min(r.right, q.right) - Math.max(r.left, q.left)
      const oy = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top)
      if (ox <= 0 || oy <= 0) continue
      const ratio = (ox * oy) / (q.width * q.height)
      const atFloor = q.width <= MIN_TARGET + 0.5 || q.height <= MIN_TARGET + 0.5
      // The real question: would a finger aimed at the middle of this control hit the control?
      const cx = Math.min(Math.max(q.left + q.width / 2, 0), innerWidth - 1)
      const cy = Math.min(Math.max(q.top + q.height / 2, 0), innerHeight - 1)
      const hit = document.elementFromPoint(cx, cy)
      const centreBlocked = !!hit && hit !== c && !c.contains(hit) && (hit === o || o.contains(hit))
      if (centreBlocked || ratio >= AREA_FAIL_RATIO || atFloor) {
        findings.push({
          kind: kindOf(o), control: describe(c), overlay: describe(o), atFloor,
          size: `${Math.round(q.width)}x${Math.round(q.height)}`,
          ratio: Math.round(ratio * 1000) / 10,
          px: `${Math.round(ox)}x${Math.round(oy)}`,
          centreBlocked,
        })
      }
    }
  }
  // Text under an overlay is a different harm and is reported, not failed.
  const textFindings = []
  for (const o of overlays) {
    if (kindOf(o) !== 'fixed') continue   // a sticky header over its own rows is the feature
    const r = o.getBoundingClientRect()
    for (const e of all) {
      if (o === e || o.contains(e) || e.contains(o)) continue
      if (e.children.length) continue
      const txt = (e.textContent || '').trim()
      if (txt.length < 12) continue
      const q = e.getBoundingClientRect()
      const ox = Math.min(r.right, q.right) - Math.max(r.left, q.left)
      const oy = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top)
      if (ox <= 4 || oy <= 4) continue
      /*
       * Bounding boxes intersecting is not the same as text being covered, and reporting the
       * first as if it were the second is how a sweep manufactures findings. A line box is as
       * wide as its container even where the glyphs stop, so a launcher in the bottom-right
       * corner "intersects" the last line of every paragraph on the page while covering no
       * letters at all. Hit-test the middle of the overlap and ask what is actually on top.
       */
      const hx = Math.min(Math.max((Math.max(r.left, q.left) + Math.min(r.right, q.right)) / 2, 0), innerWidth - 1)
      const hy = Math.min(Math.max((Math.max(r.top, q.top) + Math.min(r.bottom, q.bottom)) / 2, 0), innerHeight - 1)
      const on = document.elementFromPoint(hx, hy)
      if (!on || (on !== o && !o.contains(on))) continue
      // Something of the overlay really is on top here. Is a glyph underneath it, or empty line box?
      const range = document.createRange()
      let covered = false
      const node = [...e.childNodes].find((n) => n.nodeType === 3)
      if (node) {
        for (let i = 0; i < node.length && !covered; i++) {
          range.setStart(node, i); range.setEnd(node, i + 1)
          const g = range.getBoundingClientRect()
          if (g.width === 0) continue
          covered = g.right > r.left && g.left < r.right && g.bottom > r.top && g.top < r.bottom
        }
      }
      if (covered) textFindings.push({ overlay: describe(o), text: txt.slice(0, 40) })
    }
  }
  return {
    overlays: overlays.map((o) => `${kindOf(o)} ${describe(o)}`),
    fixedCount: overlays.filter((o) => kindOf(o) === 'fixed').length,
    controls: controls.length, findings, textFindings: textFindings.slice(0, 5),
  }
}


/**
 * The scroll offsets at which any control could sit under any fixed overlay, solved rather than
 * sampled. Shared by the run and by the selftest ON PURPOSE: a selftest that exercises its own
 * copy of this arithmetic proves that the copy works.
 */
const COLLISION_OFFSETS = () => {
      const vis = (e) => {
        const st = getComputedStyle(e)
        if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false
        const b = e.getBoundingClientRect()
        return b.width > 0 && b.height > 0
      }
      const fixed = [...document.querySelectorAll('body *')].filter((e) => {
        if (!vis(e) || getComputedStyle(e).position !== 'fixed') return false
        const b = e.getBoundingClientRect()
        return b.width >= 16 && b.height >= 16
      })
      if (!fixed.length) return []
      const CONTROL = 'button,a,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="switch"]'
      const maxScroll = Math.max(0, document.body.scrollHeight - innerHeight)
      const out = new Set([0])
      for (const o of fixed) {
        const r = o.getBoundingClientRect()   // fixed: this box does not move as the page scrolls
        for (const c of document.querySelectorAll(CONTROL)) {
          if (o === c || o.contains(c)) continue
          const q = c.getBoundingClientRect()
          if (q.width === 0 || q.height === 0) continue
          // A control can only ever collide if their horizontal bands overlap. This is the prune.
          if (q.right <= r.left || q.left >= r.right) continue
          const docTop = q.top + window.scrollY
          const lo = docTop + q.height - r.bottom   // control's bottom edge meets the overlay's bottom
          const hi = docTop - r.top                 // control's top edge meets the overlay's top
          for (const y of [lo, (lo + hi) / 2, hi]) {
            const v = Math.round(y)
            if (v >= 0 && v <= maxScroll) out.add(v)
          }
        }
      }
      // Offsets within 8px of each other test the same thing; keep one.
      const sorted = [...out].sort((a, b) => a - b)
      const kept = []
      for (const y of sorted) if (!kept.length || y - kept[kept.length - 1] > 8) kept.push(y)
      return kept
    }

async function selftest() {
  // A positive control and a negative control. A detector that has never failed is not a detector.
  const dir = mkdtempSync(join(tmpdir(), 'overlay-selftest-'))
  const page = (covered) => `<!doctype html><meta name=viewport content="width=device-width">
    <body style="margin:0">
      <button id=safe style="position:absolute;left:10px;top:10px;width:120px;height:44px">Safe</button>
      <button id=under style="position:absolute;left:${covered ? 200 : 10}px;top:200px;width:120px;height:44px">Under</button>
      <div id=fab style="position:fixed;left:200px;top:200px;width:120px;height:44px;background:#f00"></div>
    </body>`
  /*
   * The floor rule needs its OWN positive control. A 24px control clipped by 4px is 16% of its
   * area - under the 25% bar and its centre is nowhere near the overlay - so the two rules above
   * both stay silent and only the floor rule can catch it. A rule that shares a fixture with
   * another rule has not been tested; it has been alongside something that was.
   */
  const floorPage = `<!doctype html><meta name=viewport content="width=device-width">
    <body style="margin:0">
      <button id=tiny style="position:absolute;left:180px;top:300px;width:24px;height:24px"></button>
      <div id=fab2 style="position:fixed;left:200px;top:300px;width:60px;height:60px;background:#f00"></div>
    </body>`
  writeFileSync(join(dir, 'covered.html'), page(true))
  writeFileSync(join(dir, 'clear.html'), page(false))
  writeFileSync(join(dir, 'floor.html'), floorPage)
  /*
   * The positive control for SCROLLING, which is the capability most likely to rot back.
   *
   * A 3000px page whose only control sits at y=2000, hard against the right edge, with the overlay
   * fixed to the bottom-right. At scroll 0 that control is far off-screen and the page is clean by
   * every rule this sweep has. It is only obstructed once the page has been scrolled to bring it
   * level with the overlay - which is the exact defect a scroll-0-only run reports as ZERO.
   */
  const scrollPage = `<!doctype html><meta name=viewport content="width=device-width">
    <body style="margin:0;height:3000px">
      <button id=deep style="position:absolute;right:14px;top:2000px;width:24px;height:24px"></button>
      <div id=fab3 style="position:fixed;right:10px;bottom:10px;width:46px;height:46px;background:#f00"></div>
    </body>`
  writeFileSync(join(dir, 'scroll.html'), scrollPage)
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport: { width: 320, height: 640 } })
  const p = await ctx.newPage()
  let ok = true
  for (const [file, expect] of [['covered.html', true], ['clear.html', false]]) {
    await p.goto('file://' + join(dir, file))
    const r = await p.evaluate(PROBE, [AREA_FAIL_RATIO, WCAG_MIN_TARGET_PX])
    const fired = r.findings.some((f) => f.centreBlocked)
    const pass = fired === expect
    if (!pass) ok = false
    console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${file}: centre-blocked reported ${fired}, expected ${expect}`)
  }
  await p.goto('file://' + join(dir, 'floor.html'))
  const fr = await p.evaluate(PROBE, [AREA_FAIL_RATIO, WCAG_MIN_TARGET_PX])
  const floorFired = fr.findings.some((f) => f.atFloor)
  const quietOtherwise = !fr.findings.some((f) => f.centreBlocked || f.ratio >= AREA_FAIL_RATIO * 100)
  if (!floorFired || !quietOtherwise) ok = false
  console.log(`  ${floorFired ? 'ok  ' : 'FAIL'} floor.html: a 24px control clipped by 4px reported atFloor=${floorFired}`)
  console.log(`  ${quietOtherwise ? 'ok  ' : 'FAIL'} floor.html: the centre and area rules correctly stayed silent (${quietOtherwise})`)
  // Does sampling down the page find what scroll 0 cannot see?
  await p.goto('file://' + join(dir, 'scroll.html'))
  const probeAt = async (y) => {
    await p.evaluate((yy) => window.scrollTo(0, yy), y)
    await p.waitForTimeout(120)
    return p.evaluate(PROBE, [AREA_FAIL_RATIO, WCAG_MIN_TARGET_PX])
  }
  const atTop = await probeAt(0)
  const offs = await p.evaluate(COLLISION_OFFSETS)
  let foundDeep = false, foundAt = null
  for (const y of offs) {
    const rr = await probeAt(y)
    if (rr.findings.length) { foundDeep = true; foundAt = y; break }
  }
  const topClean = atTop.findings.length === 0
  if (!topClean || !foundDeep) ok = false
  console.log(`  ${topClean ? 'ok  ' : 'FAIL'} scroll.html: at scroll 0 the page is clean (${atTop.findings.length} finding(s)) - a scroll-0-only run reports nothing here`)
  console.log(`  ${foundDeep ? 'ok  ' : 'FAIL'} scroll.html: ${offs.length} collision offset(s) computed; the obstruction was found${foundAt !== null ? ` at scroll ${foundAt}` : ''}`)

  await b.close()
  console.log(ok ? '\nselftest: the detector fires on a covered control and stays silent on a clear one,'
                 + '\n          and sampling down the page finds what scroll 0 cannot see.'
                 : '\nselftest: FAILED. The sweep cannot be trusted until this passes.')
  process.exit(ok ? 0 : 1)
}

if (process.argv.includes('--selftest')) await selftest()

const EMAIL = process.env.SWEEP_EMAIL
const PASSWORD = process.env.SWEEP_PASSWORD
if (!EMAIL || !PASSWORD) {
  console.error('overlay sweep: SWEEP_EMAIL and SWEEP_PASSWORD are required.')
  console.error('  Every app route is gated. Without a session this sweep would walk a wall of')
  console.error('  sign-in pages, find no overlays over no controls, and report a clean run.')
  console.error('  Credentials are read from the environment and are never stored in this file.')
  process.exit(2)
}

const discovered = discoverRoutes()
const routes = discovered.filter((r) => typeof r === 'string')
const skipped = discovered.filter((r) => typeof r !== 'string')
console.log(`overlay sweep: ${routes.length} route(s) discovered from the router, ${PROFILES.map((p) => `${p.width}x${p.height}`).join(', ')}.`)
console.log('  NOTE: every route is measured AFTER hydration. The launcher steps aside from a client')
console.log('        effect, so the window between first paint and hydration is deliberately out of')
console.log('        this run\'s scope and is covered by the launcher not painting until it has looked.')
for (const s of skipped) console.log(`  not visited: ${s.skipped} (${s.why})`)

const MINLABEL = WCAG_MIN_TARGET_PX
const browser = await chromium.launch()
let failures = 0
let visited = 0
for (const profile of PROFILES) {
  const { width, height } = profile
  const label = `${width}x${height}`
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height }, ignoreHTTPSErrors: true })
  const page = await ctx.newPage()
  await page.goto(BASE + '/enter', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.locator('input[type="email"]').first().fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(3000)
  if (page.url().includes('/enter')) {
    console.error(`overlay sweep: sign in failed at ${label}. Refusing to report a clean run.`)
    await browser.close(); process.exit(2)
  }
  for (const route of routes) {
    let res
    try { res = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 90000 }) }
    catch { console.log(`  ${label}  ${route}  UNREACHABLE`); continue }
    await page.waitForTimeout(1800)
    const maxScroll = await page.evaluate(() => Math.max(0, document.body.scrollHeight - innerHeight))
    const candidates = await page.evaluate(COLLISION_OFFSETS)
    const CANDIDATE_CAP = 60
    const offsets = candidates.length ? candidates.slice(0, CANDIDATE_CAP) : [0]
    const cappedOut = Math.max(0, candidates.length - offsets.length)
    const seen = new Map()
    let r = { overlays: [], fixedCount: 0, controls: 0, findings: [], textFindings: [] }
    let sampled = 0
    const startedAt = Date.now()
    for (const y of offsets) {
      if (Date.now() - startedAt > ROUTE_BUDGET_MS) break
      await page.evaluate((yy) => window.scrollTo(0, yy), y)
      await page.waitForTimeout(SETTLE_MS)
      // The pointer stays where it last clicked, and a parked pointer hovers what is under it.
      // Re-parked after every scroll, because scrolling changes what sits beneath it.
      await page.mouse.move(0, 0)
      const sample = await page.evaluate(PROBE, [AREA_FAIL_RATIO, WCAG_MIN_TARGET_PX])
      sampled++
      if (sample.overlays.length > r.overlays.length) r = { ...r, ...sample, findings: r.findings }
      r.controls = Math.max(r.controls, sample.controls)
      for (const f of sample.findings) {
        // One control obstructed at six offsets is one finding, reported with where it was found.
        const key = `${f.control}|${f.overlay}`
        const prev = seen.get(key)
        if (!prev) seen.set(key, { ...f, atScroll: [y] })
        else { prev.atScroll.push(y); if (f.ratio > prev.ratio) { prev.ratio = f.ratio; prev.px = f.px }
               prev.centreBlocked = prev.centreBlocked || f.centreBlocked; prev.atFloor = prev.atFloor || f.atFloor }
      }
      for (const t of sample.textFindings) {
        const key = `TEXT|${t.overlay}|${t.text}`
        if (!seen.has(key)) r.textFindings.push(t), seen.set(key, t)
      }
    }
    r.findings = [...seen.values()].filter((v) => v.control)
    const skipped = offsets.length - sampled
    visited++
    const bad = r.findings.filter((f) => f.kind === 'fixed' && (f.centreBlocked || f.atFloor || f.ratio >= AREA_FAIL_RATIO * 100))
    const stickyNote = r.findings.filter((f) => f.kind === 'sticky').length
    if (bad.length) {
      failures += bad.length
      console.log(`  ${label}  ${route}  ${res?.status()}  *** ${bad.length} control(s) obstructed *** (${sampled} of ${candidates.length} computed collision offsets, over ${maxScroll}px)`)
      for (const f of bad.slice(0, 4)) {
        const why = f.centreBlocked ? 'CENTRE BLOCKED'
          : f.atFloor ? `AT THE ${MINLABEL}px TARGET FLOOR, ${f.ratio}% taken`
          : `${f.ratio}% covered`
        const where = f.atScroll.length === 1 ? `at scroll ${f.atScroll[0]}` : `at ${f.atScroll.length} offsets, first ${f.atScroll[0]}`
        console.log(`        ${why} (${f.px}px, control ${f.size})  ${f.overlay}  over  ${f.control}  ${where}`)
      }
    } else if (r.overlays.length) {
      const worst = r.findings.length ? Math.max(...r.findings.map((f) => f.ratio)) : 0
      console.log(`  ${label}  ${route}  ok   ${r.controls} control(s), ${r.fixedCount} fixed + ${r.overlays.length - r.fixedCount} sticky overlay(s), worst coverage ${worst}%, ${sampled}/${candidates.length} collision offsets over ${maxScroll}px${stickyNote ? `, ${stickyNote} sticky-over-control (by design)` : ''}`)
    } else {
      console.log(`  ${label}  ${route}  ok   no fixed overlay on this route`)
    }
    if (cappedOut > 0) {
      console.log(`        ⚠ ${cappedOut} computed collision offset(s) beyond the ${CANDIDATE_CAP} cap were NOT tested on this route.`)
    }
    if (skipped > 0) {
      console.log(`        ⚠ ${skipped} of ${offsets.length} scroll offsets NOT sampled: the ${ROUTE_BUDGET_MS}ms budget ran out on this route.`)
      console.log(`          This route is under-measured. A sweep that quietly stops reads exactly like one that passed.`)
    }
    for (const t of r.textFindings) console.log(`        note: ${t.overlay} sits over text "${t.text}"`)
  }
  await ctx.close()
}
await browser.close()
console.log(`\noverlay sweep: ${visited} page-width(s) visited, ${failures} obstructed control(s).`)
if (failures) {
  console.log('A control whose centre is under a fixed overlay cannot be pressed where a person aims.')
  process.exit(1)
}
