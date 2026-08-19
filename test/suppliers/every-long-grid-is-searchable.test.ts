import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/*
 * ==========================================================================================
 * EVERY GRID AN OPERATOR HAS TO FIND A ROW IN CARRIES A SEARCH BOX.
 * ==========================================================================================
 * This was reported by the founder, not caught by us, and it had been true of every long list
 * in the product at once:
 *
 *     /suppliers   3,471 rows      no search
 *     /board       1,363 rows      no search
 *     /pricing     1,201 rows      no search
 *     /monopoly      344 rows      no search
 *
 * /suppliers even PROMISED one in its own loader copy - "it is a moment, and then it is instant
 * to sort and search" - while no control existed anywhere on the page. A claim about what the
 * product does that the product did not do.
 *
 * ★ WHY A GATE AND NOT A NOTE. The four repairs are trivial and the failure was never a hard
 * problem: nobody noticed, for four pages, for months. The next long grid will be added by
 * somebody who never reads this file, and the only thing that will stop it shipping unsearchable
 * is a test that fails.
 *
 * OPTING OUT IS ALLOWED AND HAS TO BE DELIBERATE. A grid of six rows should not grow a control
 * it does not need - it just has to be named below, with the reason.
 */
const NO_SEARCH_NEEDED: Record<string, string> = {
  // (empty today: all four DataGrid callers are long lists and all four carry a box)
}

describe('every DataGrid an operator has to find a row in is searchable', () => {
  /*
   * `app/` only, and a `<DataGrid` that actually opens a JSX element.
   *
   * Both narrowings are from measured false positives on the first run: `components/ui/DataGrid.tsx`
   * names itself in its own header comment, and `components/ui/States.tsx` mentions `<DataGrid>`
   * while explaining a related behaviour. A gate that cries wolf on a doc comment gets an
   * allow-list entry per prose mention and stops meaning anything.
   */
  const callers = execFileSync(
    'git',
    ['grep', '-l', '-E', '<DataGrid$|<DataGrid[[:space:]]', '--', 'app'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  it('found the grids at all, so a pass means something', () => {
    // A positive control for the gate. Without it, a broken grep reads as "everything is fine".
    expect(callers.length).toBeGreaterThanOrEqual(4)
  })

  it('has no grid without a search box or a stated reason', () => {
    const missing: string[] = []
    for (const file of callers) {
      if (file in NO_SEARCH_NEEDED) continue
      const src = readFileSync(file, 'utf8')
      if (!/\bsearch=\{\{/.test(src)) missing.push(file)
    }
    expect(
      missing,
      'this grid has no search box. Add `search={{ fields, placeholder, label }}`, or if it is ' +
        'genuinely short enough not to need one, list it in NO_SEARCH_NEEDED with the reason.',
    ).toEqual([])
  })

  it('lists nothing that has since been deleted or already fixed', () => {
    const stale = Object.keys(NO_SEARCH_NEEDED).filter((f) => {
      if (!callers.includes(f)) return true
      return /\bsearch=\{\{/.test(readFileSync(f, 'utf8'))
    })
    expect(stale, 'a stale opt-out hides the fact that this grid changed').toEqual([])
  })

  it('searches identifiers, never the enumerations that are already filters', () => {
    /*
     * The rule from `components/ui/row-search.ts`, enforced rather than described.
     *
     * Folding a small enumeration into the haystack is the one way to make a search box worse
     * than none: "manufacturer" then returns every stocking firm and "open" returns most of the
     * board, so the operator learns the box is noise and stops using it. These names are the
     * actual filter fields on these four pages.
     */
    const FILTER_FIELDS = [
      'prospectTier',
      'prospectScore',
      'holdsInventory',
      'samStatus',
      'cageStatus',
      'currentlyInBusiness',
      'employees',
      'automated',
      'lifecycle',
      'standing',
      'soleSource',
      'rung',
      'confidence',
    ]
    const offenders: string[] = []
    for (const file of callers) {
      const src = readFileSync(file, 'utf8')
      // the fields callback, whether inline or a named constant assigned in the same file
      for (const m of src.matchAll(/fields:\s*(?:\(r[^)]*\)\s*=>\s*)?\[([^\]]*)\]/g)) {
        const body = m[1] ?? ''
        for (const f of FILTER_FIELDS) {
          if (new RegExp(`\\br\\.${f}\\b`).test(body)) offenders.push(`${file}: r.${f}`)
        }
      }
      for (const m of src.matchAll(/SEARCH_FIELDS\s*=\s*\(r[^)]*\)\s*=>\s*\[([^\]]*)\]/g)) {
        const body = m[1] ?? ''
        for (const f of FILTER_FIELDS) {
          if (new RegExp(`\\br\\.${f}\\b`).test(body)) offenders.push(`${file}: r.${f}`)
        }
      }
    }
    expect(offenders, 'that field is a filter, not an identifier').toEqual([])
  })
})
