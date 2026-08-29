/**
 * REAL BROWSER TEST OF THE MOBILE AWARD-TABLE CAP. Owner: @OS-LEAD. Any lane may run it.
 *
 *   node scripts/verify-corner-reachability.mjs
 *
 * Needs no server and no data: it renders the exact DOM `Scrollable` emits against the REAL
 * `corner.module.css`, because the thing under test is a CSS cascade, not a data path.
 *
 * ★ WHY THIS EXISTS. On 2026-08-24 the award table was capped on a phone at its ten most recent
 * rows, and the comment claimed the hidden ones "stay findable by the browser's own find". That
 * was measured FALSE: `display: none` generates no boxes, so a capped row is not in the rendered
 * text layer, and the rendered text layer is what find-in-page reads. The fix was a `<details>`
 * the operator can press. On 2026-08-29 a scoring merge DELETED that control while leaving the
 * cap and its `:has()` reveal in the stylesheet, so the cap outlived its own escape hatch. Every
 * unit test passed, tsc passed, the lint gate passed, and 564 rows on the largest corner became
 * unreachable on a phone.
 *
 * `test/design/mobile-cap-has-its-escape-hatch.test.ts` guards the SOURCE LINKAGE and says so.
 * THIS is the other half: the computed result, in a real browser, at a real width.
 *
 * Engine: chromium via Playwright (on this box, linux/arm64). Not Chrome, and it does not claim
 * to be - a headless chromium is the instrument, and naming it honestly is part of the result.
 */

import { readFileSync } from 'node:fs'

const CSS_PATH = 'app/(app)/corner/[nsn]/corner.module.css'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  // A check that silently passes is not a check. This is a hard failure, not a skip: the gate
  // cannot tell you the rows are reachable if it never opened a browser.
  process.stdout.write(
    'corner reachability: PLAYWRIGHT NOT INSTALLED. Cannot measure, so nothing is asserted.\n' +
      '        Reported rather than skipped: a gate that passes without its instrument is a false green.\n',
  )
  process.exit(1)
}

const CSS = readFileSync(CSS_PATH, 'utf8')

/*
 * The DOM `Scrollable` emits: frame > scrollArea > div.tableWrap > { table, trailing element }.
 * A CSS-module file's selectors ARE these literal class names, so rendering them against the real
 * stylesheet reproduces the exact cascade the page ships. If the markup in page.tsx changes shape,
 * the source-linkage test is what catches it; this measures the rule set.
 */
const doc = (rows, withControl) => `
<style>${CSS}</style>
<div class="frame"><div class="scrollArea"><div class="tableWrap">
<table class="table">
<thead><tr><th>Award date</th><th>Awardee</th><th class="numCol">Qty</th><th class="numCol">Unit price</th><th class="numCol">Final price</th></tr></thead>
<tbody>${Array.from(
  { length: rows },
  (_, i) =>
    `<tr><td data-label="Award date">2016-01-${String((i % 28) + 1).padStart(2, '0')}</td>` +
    `<td data-label="Awardee">AWARDEE ${i}</td><td class="numCol">${i}</td>` +
    `<td class="numCol">$1.0${i}</td><td class="numCol">$${i}00</td></tr>`,
).join('')}</tbody>
</table>
${
  withControl
    ? `<details class="narrowOnly olderAwards"><summary class="olderSummary">Show all ${rows} awards</summary><p class="olderNote">note</p></details>`
    : `<p class="narrowOnly">Showing the 10 most recent of ${rows} awards.</p>`
}
</div></div></div>`

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`)
}

const browser = await chromium.launch()

/** Rows PRESENT vs rows that generate boxes. In the DOM is not the same as reachable. */
async function measure({ rows, withControl, width, open }) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } })
  const page = await ctx.newPage()
  await page.setContent(doc(rows, withControl))
  if (open) await page.click('summary.olderSummary')
  const r = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('table tbody tr')]
    return { inDom: trs.length, rendered: trs.filter((t) => t.getClientRects().length > 0).length }
  })
  await ctx.close()
  return r
}

process.stdout.write('\n=== the instrument works in BOTH directions (a probe that only ever says 10 proves nothing) ===\n')
const wide = await measure({ rows: 574, withControl: true, width: 1440, open: false })
check('1440px shows every row', wide.rendered === 574 && wide.inDom === 574, `${wide.rendered}/${wide.inDom}`)

const narrowClosed = await measure({ rows: 574, withControl: true, width: 390, open: false })
check(
  '390px caps the table (the cap is real, not imagined)',
  narrowClosed.inDom === 574 && narrowClosed.rendered === 10,
  `${narrowClosed.rendered}/${narrowClosed.inDom} rendered, ${narrowClosed.inDom - narrowClosed.rendered} unreachable`,
)

process.stdout.write('\n=== THE PROPERTY THAT MATTERS: pressing the control returns every row ===\n')
const opened = await measure({ rows: 574, withControl: true, width: 390, open: true })
check(
  '390px, control PRESSED, all 574 rows reachable',
  opened.rendered === 574 && opened.inDom === 574,
  `${opened.rendered}/${opened.inDom}`,
)
const opened14 = await measure({ rows: 14, withControl: true, width: 390, open: true })
check('390px, control PRESSED, all 14 rows reachable', opened14.rendered === 14, `${opened14.rendered}/${opened14.inDom}`)

process.stdout.write('\n=== the regression this gate exists for: cap with no control ===\n')
const broken = await measure({ rows: 574, withControl: false, width: 390, open: false })
check(
  'without the control 564 rows are UNREACHABLE and nothing can reveal them',
  broken.inDom - broken.rendered === 564,
  `${broken.rendered}/${broken.inDom} rendered`,
)
const broken14 = await measure({ rows: 14, withControl: false, width: 390, open: false })
check(
  'reproduces the 2026-08-24 measurement exactly: 10 of 14 reachable at 390px',
  broken14.rendered === 10 && broken14.inDom === 14,
  `${broken14.rendered}/${broken14.inDom}`,
)

await browser.close()

const failed = results.filter((r) => !r.ok)
process.stdout.write(
  `\ncorner reachability: ${results.length - failed.length}/${results.length} checks passed ` +
    `(chromium, linux/${process.arch}).\n`,
)
if (failed.length) {
  process.stdout.write(`FAILED: ${failed.map((f) => f.name).join(' · ')}\n`)
  process.exit(1)
}
