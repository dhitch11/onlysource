import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * ★ THIS GATE EXISTS BECAUSE A MERGE DELETED A CONTROL AND NOTHING NOTICED. 2026-08-29.
 *
 * `corner.module.css` caps the award table on a phone at ten rows with `display: none`, and the
 * ONLY rule that gives the operator the rest back is `.tableWrap:has(.olderAwards[open])`. The
 * 08-28 scoring rework had branched from a tree that predated the control, so merging it removed
 * the `<details className={styles.olderAwards}>` element while leaving the cap and the reveal in
 * the stylesheet. Nothing conflicted. Nothing errored. Every test passed. The cap simply outlived
 * its escape hatch, and on the largest corner that is 564 award rows a phone cannot reach.
 *
 * A `:has()` reveal is uniquely prone to this: it names its trigger in the STYLESHEET, so deleting
 * the trigger in the COMPONENT breaks the pair without either file looking wrong on its own. The
 * CSS keeps parsing, the component keeps rendering, and the rows quietly stop being reachable.
 *
 * So this asserts the PAIR, not either half: every class a reveal rule depends on must still be
 * emitted by the page it styles. It is a source-linkage check and it says so - it does not claim
 * to have measured reachability in a browser. The reachability measurement that justifies the cap
 * was taken on 2026-08-24 (10 of 14 reachable at 390px against 14 of 14 in the DOM) and is
 * recorded in the CSS. What this gate defends is that the fix for it is still wired up.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

const CSS = 'app/(app)/corner/[nsn]/corner.module.css'
const PAGE = 'app/(app)/corner/[nsn]/page.tsx'

describe('the mobile award-table cap keeps the control that undoes it', () => {
  it('the cap and its reveal both still exist in the stylesheet', () => {
    const css = read(CSS)
    // The cap: rows beyond the ten most recent are given no boxes at all on a narrow screen.
    expect(css).toMatch(/\.table tbody tr:nth-last-child\(n \+ 11\)\s*\{\s*display:\s*none/)
    // The reveal: opening the control puts them back.
    expect(css).toMatch(/:has\(\.olderAwards\[open\]\)[^{]*\{\s*display:\s*block/)
  })

  it('EVERY class a :has() reveal depends on is actually emitted by the page', () => {
    const css = read(CSS)
    const page = read(PAGE)
    const triggers = [...css.matchAll(/:has\(\s*\.([A-Za-z0-9_-]+)\s*\[/g)].map((m) => m[1])
    // If this ever reads zero the test has stopped testing anything, so assert it found the pair.
    expect(triggers.length).toBeGreaterThan(0)
    const orphaned = triggers.filter((cls) => !page.includes(`styles.${cls}`))
    expect(orphaned).toEqual([])
  })

  it('the control is a real pressable element, not a sentence claiming the rows are elsewhere', () => {
    const page = read(PAGE)
    // A <details>/<summary> is claimed for ONE property: opening it shows the rows. That is
    // verifiable by clicking, which is why it was chosen over a promise about find-in-page.
    expect(page).toMatch(/<details[^>]*styles\.olderAwards/)
    expect(page).toMatch(/<summary[^>]*styles\.olderSummary/)
  })

  it('the page does NOT re-assert the claim that was measured false', () => {
    const page = read(PAGE)
    // `display: none` generates no boxes, so a hidden row is not in the rendered text layer and
    // find-in-page cannot reach it. Being in the DOM is not being reachable.
    expect(page).not.toMatch(/findable by the browser's own find/)
    // And it must not tell a phone the rows are already on the page in front of them.
    expect(page).not.toMatch(/The rest are on this page and appear on a wider screen/)
  })

  it('the cap fails OPEN where :has() is unsupported, so no browser hides rows with no way in', () => {
    const css = read(CSS)
    expect(css).toMatch(/@supports not selector\(:has\(\*\)\)/)
  })
})
