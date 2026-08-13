/**
 * REAL USER TEST OF THE SHELL. Owner: T1 FOUNDATION. Any lane may run it.
 *
 *   node scripts/verify-shell.mjs http://localhost:3211
 *
 * A green build, a 200 and a passing unit test are not evidence. This drives a real browser,
 * at 390 and 1440, clicks the controls, submits the forms, walks the page with the keyboard,
 * and MEASURES COMPUTED VALUES rather than reading the source. It reports every check as a
 * pass or a fail with the measured number, and exits non-zero if anything failed.
 *
 * Two properties it is built around:
 *   PROBE LANDED AND GATE FIRED ARE SEPARATE BOOLEANS. A check that never reached the page
 *   proves nothing, so every check first asserts it found what it was looking at.
 *   IT MEASURES THE COMPUTED RESULT. A CSS rule can ship, grep as present, and still lose on
 *   cascade order. getComputedStyle is the only thing that knows.
 */

import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3211'
const PHRASE = process.env.PREVIEW_GATE_PASSWORD ?? 'local-verify-phrase'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`)
}

const WIDTHS = [
  { label: '390 (phone)', width: 390, height: 844 },
  { label: '1440 (desktop)', width: 1440, height: 900 },
]

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

  // ---------------------------------------------------------------- the gate
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })

  check(
    'anonymous visitor lands on the gate, not the workspace',
    page.url().includes('/enter'),
    page.url().replace(BASE, ''),
  )

  const phraseField = page.locator('#password')
  check('probe landed: the phrase field exists', (await phraseField.count()) === 1)

  // The workspace must not be in the bytes at all, not merely hidden.
  const html = await page.content()
  check(
    'workspace content is absent from the served bytes, not just hidden',
    !html.includes('Next award cutoff'),
    `${html.length} bytes served`,
  )

  // ------------------------------------------------- computed values, not source
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  check(
    'body renders the approved dark ground, measured not assumed',
    bg === 'rgb(10, 13, 11)',
    `computed body background = ${bg}`,
  )

  const smallest = await page.evaluate(() => {
    let min = Infinity
    let worst = ''
    for (const el of document.querySelectorAll('body *')) {
      if (!el.textContent?.trim()) continue
      const s = parseFloat(getComputedStyle(el).fontSize)
      if (s > 0 && s < min) {
        min = s
        worst = el.tagName + '.' + (el.className || '(none)')
      }
    }
    return { min, worst }
  })
  check(
    'no text below the 13px floor',
    smallest.min >= 12.99,
    `smallest = ${smallest.min}px on ${smallest.worst}`,
  )

  // ---------------------------------------------------------- no horizontal scroll
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }))
  check(
    'no horizontal scroll',
    overflow.doc <= overflow.win + 1,
    `scrollWidth ${overflow.doc} vs innerWidth ${overflow.win}`,
  )

  // ------------------------------------------------------------- keyboard reachability
  await page.keyboard.press('Tab')
  const firstFocus = await page.evaluate(() => ({
    cls: document.activeElement?.className ?? '',
    tag: document.activeElement?.tagName ?? '',
  }))
  check(
    'first Tab lands on a real interactive control on the gate page',
    ['BUTTON', 'INPUT', 'A'].includes(firstFocus.tag),
    `focused: ${firstFocus.tag}.${firstFocus.cls || '(none)'}`,
  )

  const focusRing = await page.evaluate(() => {
    const el = document.querySelector('#password')
    el?.focus()
    const s = getComputedStyle(el)
    return { width: s.outlineWidth, style: s.outlineStyle, color: s.outlineColor }
  })
  check(
    'focused input shows a real focus ring',
    focusRing.style !== 'none' && parseFloat(focusRing.width) > 0,
    `outline ${focusRing.width} ${focusRing.style} ${focusRing.color}`,
  )

  // --------------------------------------------------------------- NEGATIVE PATH first
  /*
   * WAIT FOR THE URL, NOT FOR networkidle.
   *
   * A Server Action is a POST followed by a redirect. `networkidle` can resolve while the
   * redirect is still in flight, so `page.url()` returns the PREVIOUS location and the
   * assertion reads one step behind. That produced four confident FAILs against an app whose
   * own server log said `gate.opened outcome=allowed` at the same instant. The harness was
   * wrong, not the product. Waiting on the destination removes the race entirely.
   */
  await phraseField.fill('definitely-the-wrong-phrase')
  await Promise.all([
    page.waitForURL(/\/enter\?/, { timeout: 15000 }).catch(() => {}),
    page.getByRole('button', { name: /^enter$/i }).click(),
  ])
  await page.waitForLoadState('domcontentloaded')

  const refusedText = await page.textContent('body')
  check(
    'a wrong phrase is REFUSED and says so',
    /not the access phrase/i.test(refusedText ?? ''),
    page.url().replace(BASE, ''),
  )
  check(
    'refusal does not leak the workspace',
    !(await page.content()).includes('Next award cutoff'),
  )

  const alertRole = await page.locator('[role="alert"]').count()
  check('the refusal is announced to assistive tech, not just coloured', alertRole >= 1)

  // ------------------------------------------------------------------- HAPPY PATH
  await page.locator('#password').fill(PHRASE)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/enter'), { timeout: 15000 }).catch(() => {}),
    page.getByRole('button', { name: /^enter$/i }).click(),
  ])
  await page.waitForLoadState('domcontentloaded')

  check(
    'the correct phrase opens the workspace',
    !page.url().includes('/enter'),
    page.url().replace(BASE, ''),
  )

  const workspace = await page.textContent('body')
  check(
    'probe landed: the workspace actually rendered',
    /foundation is up/i.test(workspace ?? ''),
  )

  // The award clock must render its labelled state, never a bare deadline.
  check(
    'the deadline renders its unresolved-component qualifier',
    /counting/i.test(workspace ?? ''),
  )
  check(
    'the CITED offset is NOT hedged as unconfirmed',
    !/3 business day offset is not confirmed/i.test(workspace ?? ''),
  )

  // Every subsystem states connected or not connected. Nothing silent.
  const notConnected = (workspace ?? '').match(/not connected/g)?.length ?? 0
  check(
    'unconfigured subsystems say so plainly rather than looking fine',
    notConnected >= 1,
    `${notConnected} subsystems reported not connected`,
  )

  // The skip link belongs to the APP SHELL, so it is checked here and not on the gate page,
  // which has no shell to skip.
  await page.keyboard.press('Tab')
  const shellFirstFocus = await page.evaluate(() => document.activeElement?.className ?? '')
  check(
    'inside the shell, the first Tab reaches the skip link',
    shellFirstFocus.includes('skip-link'),
    `focused: ${shellFirstFocus || '(nothing)'}`,
  )

  // ------------------------------------------------------- click the affordance
  const details = page.locator('details').first()
  if ((await details.count()) > 0) {
    const before = await details.evaluate((d) => d.open)
    await details.locator('summary').click()
    const after = await details.evaluate((d) => d.open)
    check('the explanation affordance opens on click', before === false && after === true)
  } else {
    check('probe landed: an explanation affordance exists', false, 'no <details> found')
  }

  // ------------------------------------------------------------- overflow again
  const wsOverflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }))
  check(
    'workspace has no horizontal scroll',
    wsOverflow.doc <= wsOverflow.win + 1,
    `scrollWidth ${wsOverflow.doc} vs innerWidth ${wsOverflow.win}`,
  )

  await page.screenshot({
    path: `artifacts/shell-${vp.width}.png`,
    fullPage: true,
  })

  // ------------------------------------------------------------------- sign out
  await Promise.all([
    page.waitForURL(/\/enter/, { timeout: 15000 }).catch(() => {}),
    page.getByRole('button', { name: /leave/i }).click(),
  ])
  await page.waitForLoadState('domcontentloaded')
  check('Leave returns to the gate', page.url().includes('/enter'), page.url().replace(BASE, ''))

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  check(
    'after leaving, the workspace is closed again',
    page.url().includes('/enter'),
    'session actually revoked',
  )

  check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await context.close()
}

await browser.close()

const failed = results.filter((r) => !r.ok)
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`)
if (failed.length) {
  process.stdout.write(`\nFAILURES:\n${failed.map((f) => `  ${f.name}  ${f.detail}`).join('\n')}\n`)
  process.exit(1)
}
