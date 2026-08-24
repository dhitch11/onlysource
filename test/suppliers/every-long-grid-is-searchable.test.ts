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

/**
 * ★ WHY THIS FILE NOW STRIPS COMMENTS BEFORE IT LOOKS FOR A TAG.
 *
 * The header above records two false positives from this gate's first run, both of them a file
 * NAMING the component in prose. On 2026-08-24 it happened a third time and this time it went
 * red on a push: a comment in `app/(app)/goldmine/page.tsx` explained why that page copies the
 * grid's row-key rule instead of importing it, and it spelled the component as JSX. The page
 * imports no grid and renders none. The gate reported a hand-rolled table as an unsearchable
 * grid, and the honest repair was to move the prose.
 *
 * Moving prose is a repair for one instance. THIS is the repair for the class: a JSX element
 * OPENS code, a prose mention sits inside a comment, and the two can be told apart. So the
 * source is stripped of block and line comments before any tag is looked for.
 *
 * Not a parser, and it does not pretend to be: a `/*` inside a string literal would confuse it.
 * That is acceptable for a gate whose job is finding an opening tag in JSX, and it is stated
 * here rather than discovered.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
}

/** Does this source OPEN the named JSX element, outside of any comment? */
export function opensJsxElement(src: string, tag: string): boolean {
  return new RegExp(`<${tag}(?=[\\s/>])`).test(stripComments(src))
}

/** A search affordance, either the shared grid's prop or a hand-rolled search input. */
export function hasSearchAffordance(src: string): boolean {
  return /\bsearch=\{\{/.test(src) || /type="search"/.test(src)
}

/**
 * ==========================================================================================
 * HAND-ROLLED TABLES, WHICH THIS GATE COULD NOT SEE AT ALL UNTIL NOW.
 * ==========================================================================================
 * The gate above only ever inspected callers of the shared grid. `/goldmine` rendered 187 rows
 * across FOUR hand-rolled `<table>` elements with no search box, no sort control and no input of
 * any kind, and this file reported it as fine every single run, because it was never looking.
 *
 * A KNOWN GAP IS NOT AN EXEMPTION, AND THE DIFFERENCE IS THE POINT.
 * `NO_SEARCH_NEEDED` above means "this list is short enough not to need a box". Using it for a
 * page that plainly needs one would park a false statement in an allow-list and hide the very
 * thing this gate exists to surface. So gaps that are real and not yet fixed live HERE instead,
 * each carrying the row count measured in a real browser and the date it was found, and the test
 * below asserts every entry is STILL a gap, so a page that grows a box has to be removed from
 * this list rather than sitting here forever saying something untrue.
 */
const KNOWN_UNSEARCHABLE: Record<string, string> = {
  'app/(app)/competitor/page.tsx':
    '151 rows across 7 tables with DedicatedPullView, measured 2026-08-24. Needs a box. Reported, not yet assigned.',
  'app/(app)/competitor/DedicatedPullView.tsx':
    'the per-competitor pull tables inside /competitor, same 151 rows. Reported, not yet assigned.',
  'app/(app)/hubzone/page.tsx': '23 rows, measured 2026-08-24. Short, but unreviewed rather than ruled short enough.',
  'app/(app)/intelligence/page.tsx': '10 rows, measured 2026-08-24. Short, but unreviewed rather than ruled short enough.',
  'app/(app)/corner/[nsn]/page.tsx':
    '9 and 2 rows on the two dossiers measured 2026-08-24. Short, but unreviewed rather than ruled short enough.',
  'app/(app)/design/page.tsx':
    'the design system reference page. Its table is a type specimen, not operator data, and nobody hunts a row in it.',
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
  /*
   * `--others --exclude-standard` as well as the index, so a page that has been WRITTEN but not
   * yet committed is gated too. The previous `git grep` scanned tracked files only, which meant
   * the one moment a new unsearchable grid could be caught, before it lands, was the one moment
   * this gate was blind. Ignored files stay ignored.
   */
  const appFiles = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'app'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .map((l) => l.trim())
    .filter((f) => f.endsWith('.tsx'))
  const srcOf = new Map(appFiles.map((f) => [f, readFileSync(f, 'utf8')]))
  const callers = appFiles.filter((f) => opensJsxElement(srcOf.get(f)!, 'DataGrid'))
  const tableFiles = appFiles.filter((f) => opensJsxElement(srcOf.get(f)!, 'table'))

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

  /* ------------------------------------------------------- the widened half: hand-rolled tables */

  it('found the hand-rolled tables at all, so a pass means something', () => {
    // The second positive control. A broken scan must not read as "no hand-rolled tables exist".
    expect(tableFiles.length).toBeGreaterThanOrEqual(6)
  })

  it('has no hand-rolled table without a search box, a stated reason, or a recorded gap', () => {
    const missing = tableFiles.filter(
      (f) =>
        !(f in NO_SEARCH_NEEDED) &&
        !(f in KNOWN_UNSEARCHABLE) &&
        !hasSearchAffordance(srcOf.get(f)!),
    )
    expect(
      missing,
      'this page hand-rolls a table an operator has to find a row in and gives them no way to. ' +
        'Add a search box, or record it in KNOWN_UNSEARCHABLE with the measured row count.',
    ).toEqual([])
  })

  it('records no gap that has since been closed or deleted', () => {
    // A gap register that outlives the gap is the same lie as a stale opt-out.
    const stale = Object.keys(KNOWN_UNSEARCHABLE).filter(
      (f) => !tableFiles.includes(f) || hasSearchAffordance(srcOf.get(f) ?? ''),
    )
    expect(stale, 'this page now has a search box, so take it out of KNOWN_UNSEARCHABLE').toEqual([])
  })

  /*
   * ==========================================================================================
   * THE DETECTOR IS POINTED AT DELIBERATELY BROKEN INPUT AND MUST FAIL ON IT.
   * ==========================================================================================
   * Everything above passes trivially against a detector that returns false for everything. These
   * do not: each one hands `opensJsxElement` a case it MUST get right, including the exact prose
   * shape that took this gate red on 2026-08-24.
   */
  describe('the detector itself', () => {
    it('FIRES on a hand-rolled table with no search box', () => {
      const src = `export function T() { return (<table className={s.t}><tbody><tr><td>1</td></tr></tbody></table>) }`
      expect(opensJsxElement(src, 'table')).toBe(true)
      expect(hasSearchAffordance(src)).toBe(false)
    })

    it('STAYS SILENT on a table that carries a search input', () => {
      const src = `<input type="search" /><table className={s.t}></table>`
      expect(opensJsxElement(src, 'table')).toBe(true)
      expect(hasSearchAffordance(src)).toBe(true)
    })

    it('does NOT fire on a block comment that merely names the tag', () => {
      // The 2026-08-24 false positive, reproduced verbatim in shape.
      const src = `/*\n * A LOCAL COPY OF THE RULE <DataGrid /> USES, NOT AN IMPORT OF IT.\n */\nconst x = 1`
      expect(opensJsxElement(src, 'DataGrid')).toBe(false)
    })

    it('does NOT fire on a line comment or a JSX comment that names the tag', () => {
      expect(opensJsxElement(`// renders a <table> of rows`, 'table')).toBe(false)
      expect(opensJsxElement(`{/* a <table> goes here one day */}`, 'table')).toBe(false)
    })

    it('does not confuse a longer tag name for the one it was asked about', () => {
      expect(opensJsxElement(`<tablet foo="1" />`, 'table')).toBe(false)
      expect(opensJsxElement(`<DataGridToolbar />`, 'DataGrid')).toBe(false)
    })

    it('still fires when the tag is real code sitting beside prose about it', () => {
      const src = `/* we render a <table> below */\n<table className={s.t}>`
      expect(opensJsxElement(src, 'table')).toBe(true)
    })
  })
})
