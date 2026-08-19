import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * ==========================================================================================
 * EVERY TYPE SIZE COMES FROM THE SCALE.
 * ==========================================================================================
 * Reported by the founder: "way too many random font types and way too many random font
 * sizes ... the font in general throughout the platform on mobile and desktop just looks
 * messy."
 *
 * MEASURED BEFORE CHANGING ANYTHING, and the measurement corrected the premise in one respect
 * and confirmed it in another:
 *
 *   FAMILIES: two, --font-sans and --font-mono. Not "many". That half was not the problem.
 *   SIZES:    21 distinct hardcoded values across 36 declarations in 10 files, all of them
 *             bypassing a perfectly good seven-step scale that already existed in tokens.css.
 *
 * The damage was concentrated in a three-pixel band. Between 11px and 14.1px the product used
 * 11.2, 11.52, 11.84, 12, 12.48, 12.8, 13, 13.12, 13.28, 13.6, 13.76 and 14.08. THIRTEEN sizes
 * no reader can tell apart individually, which together are exactly what "looks messy" means:
 * not one visible mistake, but the absence of any system, felt everywhere at once.
 *
 * Two of them were defects rather than untidiness. `Admin.module.css` set both of its inputs
 * under 16px, which makes iOS Safari zoom the viewport on focus, and a severity badge a person
 * reads was set at 10px, three steps below the scale's own stated floor.
 *
 * ★ WHY A GATE. A one-off sweep leaves the next 0.82rem to be written by somebody who never
 * saw it. The scale is only a system if something enforces it.
 */

/** The scale, from styles/tokens.css. Read from the file so the test cannot drift from it. */
function scaleTokens(): string[] {
  const src = readFileSync('styles/tokens.css', 'utf8')
  return [...src.matchAll(/--fs-(\d+):/g)].map((m) => `--fs-${m[1]}`)
}

/**
 * Sizes allowed to bypass the scale, each with the reason it is not a type decision.
 *
 * ★ EVERY ENTRY IS A CLAIM THAT THIS VALUE IS NOT TEXT, or not ours to set. That is a much
 * narrower door than "we decided this one is fine", and it is the only door.
 */
const OFF_SCALE_ALLOWED: Record<string, string> = {
  'components/ui/ai-loader.module.css':
    'a tick glyph centred in a fixed 16px ring, not text; at the 13px floor it touches the border',
  'components/ui/DataGrid.module.css':
    'the disclosure chevron, sized in `em` so it tracks all three row densities',
  'components/thomas/thomas.module.css':
    'inline code in `em`, set just below its own bubble because mono runs visually larger',
  'app/api/pursuit-package/email/route.ts':
    'inline style in an EMAIL. Mail clients do not resolve CSS custom properties.',
  'app/api/outreach-draft/email/route.ts': 'the same, in the outreach email',
}

/**
 * Source with comments removed.
 *
 * ★ THIS IS NOT TIDINESS, IT IS A CORRECTION. Twice tonight a regex written to find a pattern
 * matched the explanation of that pattern in a comment written moments earlier — first a CSS
 * `@media` inside a note about cascade order, then `font: 700 10px/16px` inside the note
 * explaining why that shorthand was removed. Both times the code was already correct and the
 * instrument reported it broken.
 *
 * A scanner that reads comments is measuring the documentation, not the product.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const cssAndTs = () =>
  execFileSync('git', ['ls-files', 'app', 'components', 'styles'], { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter((f) => /\.(css|tsx?|mts)$/.test(f))

describe('the type scale is the only source of type sizes', () => {
  it('reads a real scale out of the tokens file', () => {
    // A positive control: if tokens.css is renamed or emptied, this test must fail loudly
    // rather than pass by finding nothing to check against.
    const tokens = scaleTokens()
    expect(tokens.length).toBeGreaterThanOrEqual(7)
    expect(tokens).toContain('--fs-100')
    expect(tokens).toContain('--fs-400')
  })

  it('found files to scan, so a green result means something', () => {
    expect(cssAndTs().length).toBeGreaterThan(30)
  })

  it('has no font-size outside the scale', () => {
    const offenders: string[] = []
    for (const file of cssAndTs()) {
      if (file === 'styles/tokens.css') continue // where the scale is DEFINED
      if (file in OFF_SCALE_ALLOWED) continue
      const src = readFileSync(file, 'utf8')
      /*
       * ★ EVERY LENGTH UNIT, NOT THREE. The first version of this gate read px|rem|em and
       * reported the product clean while /documents carried ten `pt` declarations. They turned
       * out to be legitimate print styles, but the gate did not know that — it simply could not
       * see them, which is the same thing as not checking.
       */
      const printOnly = /@media\s+print/.test(src)
      for (const m of src.matchAll(/font-size:\s*([0-9.]+)(px|rem|em|pt|pc|in|cm|mm|ex|ch|vw|vh|vmin|vmax)/g)) {
        // `pt` inside a print stylesheet is the correct unit for paper and is not a screen size
        if (m[2] === 'pt' && printOnly) continue
        offenders.push(`${file}: ${m[1]}${m[2]}`)
      }
      /*
       * ★ AND THE `font:` SHORTHAND, which sets size and weight while matching neither property
       * name. The notification badge hid `font: 700 10px/16px var(--font-mono)` from a sweep that
       * read every font-size and font-weight in the product. A grep for a property cannot see a
       * property set by a shorthand, and the shorthand is where a value goes to be forgotten.
       */
      for (const m of src.matchAll(/(?:^|[;{\s])font:\s*([^;}]+)/g)) {
        const v = (m[1] ?? '').trim()
        /*
         * `font: inherit` is not a type decision, it is the idiomatic refusal to make one:
         * form controls do not inherit the page font without it, and every button and input in
         * the product uses it correctly. Flagging it would put 20 correct declarations in front
         * of a reader looking for the one wrong one, and a gate that cries wolf gets muted.
         *
         * What IS flagged is a shorthand carrying an actual measurement.
         */
        if (!/[0-9]/.test(v)) continue
        offenders.push(`${file}: font shorthand "${v.slice(0, 40)}"`)
      }
    }
    expect(
      offenders,
      'use a --fs-* token. If this genuinely is not text — a glyph in a fixed badge, or an ' +
        'inline style in an email — add the file to OFF_SCALE_ALLOWED with that reason.',
    ).toEqual([])
  })

  it('has no font-weight off the ladder', () => {
    /*
     * 400 / 500 / 600 / 700 only. The live pages were measured carrying 550 (3 elements) and
     * 900 (ONE element) as well — counts that low are never a decision, they are a typo or a
     * copy-paste, and they are invisible next to their neighbours while still being wrong.
     */
    /*
     * NOTHING NUMERIC. Every weight in the product is now a token, so the gate demands one
     * rather than allowing the four "good" numbers as well. A rule that permits the correct
     * raw value is a rule that lets the ladder be bypassed by anyone who happens to guess right,
     * and the whole point of a token is that the next person does not have to guess.
     */
    const ALLOWED = new Set(['normal', 'bold', 'inherit'])
    const offenders: string[] = []
    for (const file of cssAndTs()) {
      if (file in OFF_SCALE_ALLOWED) continue
      const src = code(readFileSync(file, 'utf8'))
      /*
       * The whole declaration value, not `[\w-]+`. The first version of this regex captured
       * only "var" out of `var(--fw-600)` and then tested `v.startsWith('var(')`, which is
       * never true of the string "var" — so the guard silenced nothing and the test reported
       * every tokenised weight in the product as an offender. A capture group narrower than
       * the value it is testing is its own small version of this whole defect class.
       */
      for (const m of src.matchAll(/font-weight:\s*([^;\n}]+)/g)) {
        const v = (m[1] ?? '').trim()
        if (!ALLOWED.has(v) && !v.startsWith('var(')) offenders.push(`${file}: ${v}`)
      }
    }
    expect(offenders, 'font-weight is 400, 500, 600 or 700').toEqual([])
  })

  it('lists nothing in the exception table that no longer needs it', () => {
    const stale = Object.keys(OFF_SCALE_ALLOWED).filter((f) => {
      let src: string
      try {
        src = readFileSync(f, 'utf8')
      } catch {
        return true // the file is gone
      }
      return !/font-size:\s*[0-9.]+(px|rem|em|pt)/.test(code(src))
    })
    expect(stale, 'a stale exception is a licence nobody is using, and it hides a change').toEqual(
      [],
    )
  })
})
