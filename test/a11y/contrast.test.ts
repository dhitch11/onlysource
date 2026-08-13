/**
 * Contrast is MEASURED, not eyeballed.
 *
 * This test parses `app/globals.css` and computes real WCAG 2.x contrast ratios on the
 * values that actually ship. It does not read a duplicated palette from a TypeScript file,
 * because a duplicated palette drifts and then the test is measuring something nobody sees.
 *
 * The instrument proves it can fail: the last case asserts that a deliberately bad pair
 * (mid grey on white) is rejected by the same function that passes the shipped pairs.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url))
const css = readFileSync(cssPath, 'utf8')

function tokens(source: string): Map<string, string> {
  const map = new Map<string, string>()
  const rootBlock = source.slice(source.indexOf(':root'), source.indexOf('\n}', source.indexOf(':root')))
  for (const match of rootBlock.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    map.set(`--${match[1]}`, (match[2] ?? '').toLowerCase())
  }
  return map
}

const T = tokens(css)

function srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function token(name: string): string {
  const value = T.get(name)
  if (!value) throw new Error(`contrast test: token ${name} is not in app/globals.css`)
  return value
}

/** Rounded to two places so a failure message reads like a measurement. */
const ratio = (fg: string, bg: string) => Math.round(contrastRatio(token(fg), token(bg)) * 100) / 100

describe('the palette was parsed from the file that ships', () => {
  it('found every token the shell uses', () => {
    expect(T.size).toBeGreaterThanOrEqual(18)
    expect(T.get('--c-bg')).toBe('#ffffff')
  })
})

describe('WCAG AA 4.5:1, normal body text', () => {
  const textPairs: Array<[string, string, string]> = [
    ['primary text on page background', '--c-text', '--c-bg'],
    ['primary text on raised surface', '--c-text', '--c-surface'],
    ['secondary text on page background', '--c-text-secondary', '--c-bg'],
    ['secondary text on raised surface', '--c-text-secondary', '--c-surface'],
    ['secondary text on sunken surface', '--c-text-secondary', '--c-surface-sunken'],
    ['link and accent text on page background', '--c-accent', '--c-bg'],
    ['link and accent text on raised surface', '--c-accent', '--c-surface'],
    ['accent hover text on page background', '--c-accent-hover', '--c-bg'],
    ['button label on the accent fill', '--c-text-inverse', '--c-accent'],
    ['button label on the accent hover fill', '--c-text-inverse', '--c-accent-hover'],
    ['notice text on notice background', '--c-notice-fg', '--c-notice-bg'],
    ['attention text on attention background', '--c-attention-fg', '--c-attention-bg'],
    ['danger text on danger background', '--c-danger-fg', '--c-danger-bg'],
    ['ok text on ok background', '--c-ok-fg', '--c-ok-bg'],
  ]

  for (const [label, fg, bg] of textPairs) {
    it(`${label} meets 4.5:1`, () => {
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5)
    })
  }
})

/*
 * `--c-border` is deliberately NOT in the list below and that is a decision, not an
 * oversight. It draws card outlines and row rules, which are decoration: no control is
 * identified by it and no content depends on it. WCAG 1.4.11 covers control boundaries and
 * meaningful graphics, and asserting 3:1 on a hairline divider would force a heavier UI for
 * no accessibility gain. `--c-border-strong`, which draws the edge of an actual input, IS
 * in the list.
 */
describe('WCAG AA 3:1, non-text boundaries a user has to find', () => {
  const uiPairs: Array<[string, string, string]> = [
    ['input border against the page', '--c-border-strong', '--c-bg'],
    ['input border against a raised surface', '--c-border-strong', '--c-surface'],
    ['focus ring against the page', '--c-focus', '--c-bg'],
    ['focus ring against a raised surface', '--c-focus', '--c-surface'],
    ['accent fill against the page, so a button has an edge', '--c-accent', '--c-bg'],
  ]

  for (const [label, fg, bg] of uiPairs) {
    it(`${label} meets 3:1`, () => {
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3)
    })
  }
})

describe('the instrument can fail', () => {
  it('rejects a pair that a person would call "probably fine"', () => {
    // #949494 on white is 2.85:1. It looks readable in a screenshot and it is not compliant.
    expect(contrastRatio('#949494', '#ffffff')).toBeLessThan(4.5)
  })

  it('agrees with a published reference value', () => {
    // Pure black on pure white is exactly 21:1 by definition.
    expect(Math.round(contrastRatio('#000000', '#ffffff'))).toBe(21)
    // #767676 on white is the canonical 4.54:1 boundary example.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5)
  })
})
