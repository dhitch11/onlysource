/**
 * REAL USER TEST OF THE DOCUMENTS AND POs SCREEN. Owner: T5 DOCUMENTS. Any lane may run it.
 *
 *   node scripts/verify-documents.mjs http://localhost:3517
 *
 * This is T1's `verify-shell.mjs` extended to this lane's surface, deliberately reusing its
 * conventions rather than inventing a second style: the same `check()` reporting, the same
 * probe-landed-before-gate-fired discipline, and the same rule that a computed value is the only
 * thing worth measuring. Two differences, both because of what this screen is:
 *
 *   FOUR WIDTHS, NOT TWO. 320 is in because WCAG 1.4.10 sets the reflow floor there and because
 *   1280 at 400% zoom is 320, which is a realistic setting for this population. 768 is in because
 *   T8's three narrow-viewport defects were invisible at 1440 and one of them only appeared between
 *   the phone and the desktop.
 *
 *   IT DRIVES THE PIPELINE, NOT JUST THE PAGE. The screen's whole purpose is the generator, so the
 *   run submits the form with real values, then with the whitespace input that was a stop-ship, and
 *   asserts on what the page then says. A screenshot of an empty form proves nothing about it.
 *
 * WHAT IT REFUSES TO CALL A PASS: a horizontal scrollbar on the page, a font below the 13px floor,
 * an amber or red anywhere (those are reserved for the auto-award clock and this screen has no
 * clock), any console error, and a "Ready to submit" chip on a deliverable with no rendered artifact.
 */

import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3517'
const PHRASE = process.env.PREVIEW_GATE_PASSWORD ?? 'local-verify-phrase'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`)
}

const WIDTHS = [
  { label: '320 (reflow floor / 1280 at 400%)', width: 320, height: 800 },
  { label: '390 (phone)', width: 390, height: 844 },
  { label: '768 (tablet)', width: 768, height: 1024 },
  { label: '1440 (desktop)', width: 1440, height: 900 },
]

/** A realistic lot: broker stock, L04 path, enough to assemble. */
const REAL = new URLSearchParams({
  nsn: '1650-01-059-8221',
  cage: '99207',
  part_number: '70550-28900-106',
  qty: '190',
  unit_price: '3565.00',
  validity_days: '120',
  supplier: 'OLY Aero',
  solicitation_number: 'SPE4A626Q0227',
  material_condition: 'new_unused',
  acquisition_channel: 'dealer_purchase',
  type_character: 'T',
}).toString()

/** T4's stop-ship input: everything real except a price and a quantity of three spaces. */
const WHITESPACE = new URLSearchParams({
  nsn: '5325015619853',
  cage: '58794',
  solicitation_number: 'SPE4A626T14YZ',
  validity_days: '30',
  material_condition: 'new_unused',
  acquisition_channel: 'dealer_purchase',
  supplier: 'OLY Aero',
  unit_price: '   ',
  qty: '   ',
}).toString()

const browser = await chromium.launch()

for (const vp of WIDTHS) {
  process.stdout.write(`\n=== ${vp.label} ===\n`)
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  // ---------------------------------------------------------------- through the gate
  await page.goto(`${BASE}/documents`, { waitUntil: 'networkidle' })
  if (page.url().includes('/enter')) {
    await page.locator('#password').fill(PHRASE)
    await page.locator('form button[type=submit]').first().click()
    await page.waitForLoadState('networkidle')
  }
  const onDocs = page.url().includes('/documents')
  check('probe landed: the documents screen is reachable', onDocs, page.url().replace(BASE, ''))
  if (!onDocs) {
    await context.close()
    continue
  }

  // ---------------------------------------------------------------- the empty state
  const emptyText = await page.locator('body').innerText()
  check(
    'the empty state is honest, and no sample row stands in for a real one',
    emptyText.includes('no lot has been captured') && !/Moog|OLY Aero .*PO draft/.test(emptyText),
  )

  // ---------------------------------------------------------------- geometry, measured
  const geom = async (label) => {
    const m = await page.evaluate(() => {
      const de = document.documentElement
      let widest = ''
      let widestPx = 0
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width > widestPx) {
          widestPx = r.width
          widest = `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 28)}`
        }
      }
      let minFont = Infinity
      let worst = ''
      for (const el of document.querySelectorAll('body *')) {
        if (!el.textContent?.trim()) continue
        if (el.children.length > 0) continue
        const px = parseFloat(getComputedStyle(el).fontSize)
        if (px < minFont) {
          minFont = px
          worst = el.tagName.toLowerCase()
        }
      }
      // Amber and red are reserved for the auto-award clock. This screen has no clock.
      const reserved = []
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el)
        for (const v of [cs.color, cs.backgroundColor, cs.borderLeftColor]) {
          const mm = v.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
          if (!mm) continue
          const [r, g, b] = [Number(mm[1]), Number(mm[2]), Number(mm[3])]
          // amber #E4A83E and red #D16044 as shipped in tokens.css
          if ((r === 228 && g === 168 && b === 62) || (r === 209 && g === 96 && b === 68)) {
            reserved.push(`${el.tagName.toLowerCase()} ${v}`)
          }
        }
      }
      return {
        scrollW: de.scrollWidth,
        clientW: de.clientWidth,
        widest,
        widestPx: Math.round(widestPx),
        minFont,
        worst,
        reserved: reserved.slice(0, 3),
      }
    })
    check(
      `${label}: no horizontal page scroll`,
      m.scrollW <= m.clientW + 1,
      `scrollWidth ${m.scrollW} vs clientWidth ${m.clientW}, widest element ${m.widest} at ${m.widestPx}px`,
    )
    check(
      `${label}: no text below the 13px floor`,
      m.minFont >= 13,
      `smallest computed ${m.minFont}px on <${m.worst}>`,
    )
    check(
      `${label}: amber and red stay reserved for the auto-award clock`,
      m.reserved.length === 0,
      m.reserved.join('; ') || 'none present',
    )
    return m
  }

  await geom('empty')

  // ---------------------------------------------------------------- drive the real pipeline
  await page.goto(`${BASE}/documents?${REAL}`, { waitUntil: 'networkidle' })
  const realText = await page.locator('body').innerText()
  check(
    'probe landed: the pipeline ran and classified the lot',
    realText.includes('L04 part-numbered traceability path'),
  )
  check(
    'the traceability packet actually assembled, with its body on the page',
    realText.includes('TRACEABILITY PACKET, L04') && realText.includes('1650-01-059-8221'),
  )
  check(
    'every rendered figure is listed with its source',
    realText.includes('operator entry, unsaved'),
  )
  await geom('populated')

  // The chip must not be able to say ready with no artifact. Measured on the page, not in a unit.
  const chipAudit = await page.evaluate(() => {
    const out = []
    for (const li of document.querySelectorAll('li, article')) {
      const t = li.innerText || ''
      if (/Ready to submit/.test(t)) out.push(t.split('\n')[0])
    }
    return out
  })
  check(
    'no deliverable claims Ready to submit on this lot (a PO waits for a person; nothing is complete)',
    chipAudit.length === 0,
    chipAudit.join(' | ') || 'no ready chips present',
  )

  // ---------------------------------------------------------------- the stop-ship input
  await page.goto(`${BASE}/documents?${WHITESPACE}`, { waitUntil: 'networkidle' })
  const wsText = await page.locator('body').innerText()
  check(
    'probe landed: the whitespace lot rendered a page',
    wsText.includes('Documents and POs'),
  )
  check(
    'whitespace price and quantity do NOT produce a computed total',
    !wsText.includes('Extended total: 0.00'),
  )
  check(
    'the purchase order says which fields are missing instead of building',
    /Missing\s+f3/.test(wsText) || wsText.includes('Missing f3'),
    'names the unit-price reference',
  )

  // ---------------------------------------------------------------- keyboard
  await page.goto(`${BASE}/documents?${REAL}`, { waitUntil: 'networkidle' })
  const reachable = await page.evaluate(async () => {
    const focusables = document.querySelectorAll(
      'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
    )
    return focusables.length
  })
  check('the screen has keyboard-reachable controls', reachable > 10, `${reachable} focusable stops`)

  const explain = page.locator('button[aria-expanded]').first()
  const hasExplain = (await explain.count()) > 0
  check('probe landed: an explain affordance exists as a real button', hasExplain)
  if (hasExplain) {
    await explain.focus()
    await page.keyboard.press('Enter')
    const opened = await explain.getAttribute('aria-expanded')
    check('the explain panel opens by keyboard, not hover', opened === 'true', `aria-expanded=${opened}`)
  }

  check('no console errors on any of the three states', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await page.screenshot({
    path: `/tmp/t5-documents-${vp.width}.png`,
    fullPage: true,
  })
  await context.close()
}

await browser.close()

const failed = results.filter((r) => !r.ok)
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`)
if (failed.length > 0) {
  process.stdout.write('FAILED:\n')
  for (const f of failed) process.stdout.write(`  - ${f.name}  ${f.detail}\n`)
  process.exit(1)
}
