/**
 * CONTRAST IS MEASURED, NOT EYEBALLED. And it is measured on the SHIPPED value.
 *
 * OWNERSHIP: @T8 owns the token VALUES in styles/tokens.css. @T1 owns this instrument.
 * That split is deliberate. The lane that picks a colour should not be the only lane that
 * checks it, and the check should live where a merge cannot land without running it.
 *
 * IT PARSES styles/tokens.css DIRECTLY. No duplicated palette in a TS file, because a
 * duplicated palette drifts and then the test measures something nobody sees. When T8
 * replaced app/globals.css wholesale this test went RED rather than silently passing on
 * tokens that no longer existed, which is the property that makes it worth having.
 *
 * ---------------------------------------------------------------------------------------
 * A BUG THIS FILE NOW GUARDS AGAINST, because I shipped it.
 * ---------------------------------------------------------------------------------------
 * I proposed #81897C as the accessible replacement for --faint and reported it at 4.51:1
 * on --raised. It measures 4.4939:1. My search walked continuous float colour space,
 * checked the threshold on the FLOAT, then rounded to hex for output, and rounding down
 * darkened the colour back below the bar. T8 caught it and shipped #838B7E at 4.6152:1.
 *
 * The lesson is the general one: VERIFY THE VALUE YOU WILL ACTUALLY SHIP, not the value
 * you computed on the way to it. This test can only ever read hex and rgba strings out of
 * the stylesheet, so the class of error is now structurally impossible here.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const tokensPath = fileURLToPath(new URL('../../styles/tokens.css', import.meta.url))
const css = readFileSync(tokensPath, 'utf8')

/**
 * THEME-AWARE PARSING, and this is the second bug this file has caught in its own author.
 *
 * My first parser took "last definition wins, matching the cascade". That is wrong for a
 * file with more than one theme. `--raised` is declared THREE times here: once dark, once
 * under :root[data-theme="light"], and once inside a prefers-color-scheme: light media
 * query. Last-wins silently resolved it to the LIGHT value, so every dark-mode assertion
 * was measuring a dark foreground against a light ground. Fifty-six assertions passed while
 * measuring the wrong thing, which is worse than failing.
 *
 * So: blocks are collected WITH their selector, and each theme is resolved separately.
 * Both themes are then gated, because "T8 builds both properly" means both get measured.
 */
type Theme = 'dark' | 'light'

function parseThemes(source: string): Record<Theme, Map<string, string>> {
  const dark = new Map<string, string>()
  const light = new Map<string, string>()

  // Walk top-level-ish blocks: a selector, then everything up to its closing brace.
  const blockRe = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  // Track whether we are inside a light-preference media query by position.
  const lightMediaStart = source.search(/@media\s*\(prefers-color-scheme:\s*light\)/i)
  const lightMediaEnd =
    lightMediaStart === -1 ? -1 : source.indexOf('\n}', source.indexOf('{', lightMediaStart))

  while ((m = blockRe.exec(source)) !== null) {
    const selector = (m[1] ?? '').trim()
    const body = m[2] ?? ''
    if (!selector.includes(':root')) continue

    const inLightMedia =
      lightMediaStart !== -1 && m.index > lightMediaStart && m.index < lightMediaEnd
    const isLightSelector = selector.includes('data-theme="light"')
    const isDarkSelector = selector.includes('data-theme="dark"')

    const targets: Map<string, string>[] = []
    if (isLightSelector || inLightMedia) targets.push(light)
    else if (isDarkSelector) targets.push(dark)
    else targets.push(dark, light) // a bare :root is the shared base for both themes

    for (const decl of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)) {
      for (const t of targets) t.set(`--${decl[1]}`, (decl[2] ?? '').trim())
    }
  }
  return { dark, light }
}

const THEMES = parseThemes(css)
const T = THEMES.dark

type Rgba = { r: number; g: number; b: number; a: number }

function parseColor(value: string): Rgba | null {
  const v = value.trim()
  const hex = v.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    let h = hex[1]!
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    }
  }
  const rgb = v.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i)
  if (rgb) {
    return { r: +rgb[1]!, g: +rgb[2]!, b: +rgb[3]!, a: rgb[4] !== undefined ? +rgb[4]! : 1 }
  }
  return null
}

/**
 * Composite a translucent colour over its opaque ground.
 * Skipping this step is what makes an alpha hairline look compliant when it is not: a
 * 0.09 alpha measured as if it were opaque overstates it by roughly six times.
 */
function over(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}

const toLinear = (c: number) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

const luminance = (c: Rgba) =>
  0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b)

function tokenIn(theme: Theme, name: string): Rgba {
  const raw = THEMES[theme].get(name)
  if (!raw) throw new Error(`contrast: token ${name} is not defined for the ${theme} theme`)
  const parsed = parseColor(raw)
  if (!parsed) throw new Error(`contrast: token ${name} is not a colour: ${raw}`)
  return parsed
}

function token(name: string): Rgba {
  return tokenIn('dark', name)
}

function contrastIn(theme: Theme, fgName: string, bgName: string): number {
  const bg = tokenIn(theme, bgName)
  const fg0 = tokenIn(theme, fgName)
  const fg = fg0.a < 1 ? over(fg0, bg) : fg0
  const la = luminance(fg)
  const lb = luminance(bg)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function contrast(fgName: string, bgName: string): number {
  const bg = token(bgName)
  const fg0 = token(fgName)
  const fg = fg0.a < 1 ? over(fg0, bg) : fg0
  const la = luminance(fg)
  const lb = luminance(bg)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Every opaque surface a foreground can land on. */
const GROUNDS = ['--bg', '--panel', '--panel-2', '--raised']

describe('the palette was parsed from the file that actually ships', () => {
  it('found the token file and the core colours', () => {
    expect(THEMES.dark.size).toBeGreaterThan(30)
    expect(THEMES.light.size).toBeGreaterThan(30)
    for (const g of GROUNDS) {
      expect(tokenIn('dark', g).a).toBe(1)
      expect(tokenIn('light', g).a).toBe(1)
    }
  })

  it('resolved the two themes to DIFFERENT grounds, or it is reading one theme twice', () => {
    // This is the assertion that would have caught my last-wins parser bug immediately.
    const darkBg = tokenIn('dark', '--raised')
    const lightBg = tokenIn('light', '--raised')
    expect(`${darkBg.r},${darkBg.g},${darkBg.b}`).not.toBe(`${lightBg.r},${lightBg.g},${lightBg.b}`)
    // And the dark ground must actually be dark, not a light value mislabelled.
    expect(luminance(darkBg)).toBeLessThan(0.2)
    expect(luminance(lightBg)).toBeGreaterThan(0.5)
  })

  it('proves the parser handles alpha, or every hairline check below is meaningless', () => {
    expect(token('--line').a).toBeLessThan(1)
    expect(token('--line-control').a).toBeLessThan(1)
  })
})

describe('WCAG 1.4.3 AA, 4.5:1. Foreground tokens used as TEXT, on every ground', () => {
  // 13px is the type floor in this system, so nothing here qualifies for the large-text
  // 3:1 allowance (which needs 18.66px bold or 24px). 4.5:1 is the bar everywhere.
  const textTokens = [
    '--ink',
    '--dim',
    '--faint',
    '--accent',
    '--accent-2',
    '--olive',
    '--amber',
    '--red',
    '--steel',
    '--violet',
  ]

  for (const theme of ['dark', 'light'] as const) {
    for (const fg of textTokens) {
      for (const bg of GROUNDS) {
        it(`[${theme}] ${fg} on ${bg}`, () => {
          const ratio = contrastIn(theme, fg, bg)
          // The message carries the measurement, so a failure reads as a number and not
          // just "expected false to be true".
          expect(`[${theme}] ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBe(
            `[${theme}] ${fg} on ${bg} = ${ratio.toFixed(2)}:1`,
          )
          expect(ratio).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
  }

  it('--accent-on-fill is legible on the brass fill it sits on', () => {
    // The primary button. Its fill is a gradient, so both stops are checked: a label that
    // passes on the light stop and fails on the dark one is still a failure.
    const label = token('--accent-on-fill')
    for (const stop of ['#d7b978', '#b6924f']) {
      const bg = parseColor(stop)!
      const la = luminance(label)
      const lb = luminance(bg)
      const [hi, lo] = la > lb ? [la, lb] : [lb, la]
      expect(`${stop}: ${((hi + 0.05) / (lo + 0.05)).toFixed(2)}`).toBe(
        `${stop}: ${((hi + 0.05) / (lo + 0.05)).toFixed(2)}`,
      )
      expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('WCAG 1.4.11 AA, 3:1. Boundaries a user must be able to find', () => {
  // --line and --line-2 are deliberately NOT here and that is a decision, not an oversight:
  // they draw decorative dividers, no control is identified by them, and 1.4.11 does not
  // reach decoration. --line-control draws the edge of a real input and IS here.
  const boundaryTokens = ['--line-control', '--focus', '--olive-dim']

  for (const theme of ['dark', 'light'] as const) {
    for (const fg of boundaryTokens) {
      for (const bg of GROUNDS) {
        it(`[${theme}] ${fg} on ${bg}`, () => {
          const ratio = contrastIn(theme, fg, bg)
          expect(`[${theme}] ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBe(
            `[${theme}] ${fg} on ${bg} = ${ratio.toFixed(2)}:1`,
          )
          expect(ratio).toBeGreaterThanOrEqual(3)
        })
      }
    }
  }
})

describe('the instrument can fail, and agrees with published reference values', () => {
  it('rejects a pair a person would call "probably fine"', () => {
    // #949494 on white is 2.85:1. It looks perfectly readable in a screenshot.
    const a = parseColor('#949494')!
    const b = parseColor('#ffffff')!
    const [hi, lo] = luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)]
    expect((hi + 0.05) / (lo + 0.05)).toBeLessThan(4.5)
  })

  it('black on white is exactly 21:1 by definition', () => {
    const a = luminance(parseColor('#000000')!)
    const b = luminance(parseColor('#ffffff')!)
    expect(Math.round((b + 0.05) / (a + 0.05))).toBe(21)
  })

  it('catches the exact value I got wrong, so this specific mistake cannot recur', () => {
    // My proposed --faint. I reported 4.51:1 on --raised by measuring the pre-rounding
    // float. The shipped hex is 4.4939:1. This asserts the failure, so if anybody ever
    // reintroduces #81897C the gate refuses it.
    const bad = parseColor('#81897C')!
    const raised = token('--raised')
    const la = luminance(bad)
    const lb = luminance(raised)
    const [hi, lo] = la > lb ? [la, lb] : [lb, la]
    expect((hi + 0.05) / (lo + 0.05)).toBeLessThan(4.5)
    // And the value T8 actually shipped clears it.
    expect(contrast('--faint', '--raised')).toBeGreaterThanOrEqual(4.5)
  })

  it('would catch a regression to either pre-fix value', () => {
    for (const [name, oldValue] of [
      ['--faint', '#636D5D'],
      ['--red', '#D16044'],
    ] as const) {
      const old = parseColor(oldValue)!
      const raised = token('--raised')
      const la = luminance(old)
      const lb = luminance(raised)
      const [hi, lo] = la > lb ? [la, lb] : [lb, la]
      expect(`${name} old ${oldValue}: ${((hi + 0.05) / (lo + 0.05)).toFixed(2)}`).toBe(
        `${name} old ${oldValue}: ${((hi + 0.05) / (lo + 0.05)).toFixed(2)}`,
      )
      expect((hi + 0.05) / (lo + 0.05)).toBeLessThan(4.5)
    }
  })
})
