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
const WIDTHS = [320, 390]
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
  await b.close()
  console.log(ok ? '\nselftest: the detector fires on a covered control and stays silent on a clear one.'
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
console.log(`overlay sweep: ${routes.length} route(s) discovered from the router, ${WIDTHS.join(' and ')} px.`)
for (const s of skipped) console.log(`  not visited: ${s.skipped} (${s.why})`)

const MINLABEL = WCAG_MIN_TARGET_PX
const browser = await chromium.launch()
let failures = 0
let visited = 0
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height: 844 }, ignoreHTTPSErrors: true })
  const page = await ctx.newPage()
  await page.goto(BASE + '/enter', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.locator('input[type="email"]').first().fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(3000)
  if (page.url().includes('/enter')) {
    console.error(`overlay sweep: sign in failed at ${width}px. Refusing to report a clean run.`)
    await browser.close(); process.exit(2)
  }
  for (const route of routes) {
    let res
    try { res = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 90000 }) }
    catch { console.log(`  ${width}  ${route}  UNREACHABLE`); continue }
    await page.waitForTimeout(1800)
    // The pointer stays where it last clicked, and a parked pointer hovers what is under it.
    await page.mouse.move(0, 0)
    const r = await page.evaluate(PROBE, [AREA_FAIL_RATIO, WCAG_MIN_TARGET_PX])
    visited++
    const bad = r.findings.filter((f) => f.kind === 'fixed' && (f.centreBlocked || f.atFloor || f.ratio >= AREA_FAIL_RATIO * 100))
    const stickyNote = r.findings.filter((f) => f.kind === 'sticky').length
    if (bad.length) {
      failures += bad.length
      console.log(`  ${width}  ${route}  ${res?.status()}  *** ${bad.length} control(s) obstructed ***`)
      for (const f of bad.slice(0, 4)) {
        const why = f.centreBlocked ? 'CENTRE BLOCKED'
          : f.atFloor ? `AT THE ${MINLABEL}px TARGET FLOOR, ${f.ratio}% taken`
          : `${f.ratio}% covered`
        console.log(`        ${why} (${f.px}px, control ${f.size})  ${f.overlay}  over  ${f.control}`)
      }
    } else if (r.overlays.length) {
      const worst = r.findings.length ? Math.max(...r.findings.map((f) => f.ratio)) : 0
      console.log(`  ${width}  ${route}  ok   ${r.controls} control(s), ${r.fixedCount} fixed + ${r.overlays.length - r.fixedCount} sticky overlay(s), worst coverage ${worst}%${stickyNote ? `, ${stickyNote} sticky-over-control (by design)` : ''}`)
    } else {
      console.log(`  ${width}  ${route}  ok   no fixed overlay on this route`)
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
