/**
 * NUMBER FORMATTING FOR THE SUPPLY GROUPS BOARD. No imports, on purpose.
 *
 * This module is loaded on BOTH sides of the hydration boundary: the page decides the board
 * on the server, and the board's own controls ("showing 12 of 78 classes") recount in the
 * browser as the operator filters. That is exactly the situation `toLocaleString` breaks in.
 * It renders a different thousands separator on a server running one locale than in the
 * reader's browser running another, which is React #418, a mismatch only production shows,
 * and this repo has been burned by that class of defect three times.
 *
 * So the grouping is done by hand. `toFixed` and `toExponential` are locale independent and
 * are used as they are.
 *
 * It imports nothing so it can be pulled into a client component without dragging the class
 * catalogue's `node:fs` read along with it.
 */

/** Thousands grouping, locale independent. */
export function count(n: number): string {
  const negative = n < 0
  const digits = Math.abs(Math.trunc(n)).toString()
  let out = ''
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return negative ? `-${out}` : out
}

/** One decimal place. The second one is noise at these sample sizes. */
export function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

/** The multiple, rendered ONLY where the evidence state permits it. */
export function liftText(lift: number): string {
  return `${lift.toFixed(1)}×`
}

/** A probability, readable at both ends of the range it actually takes. */
export function pText(p: number): string {
  if (p >= 0.001) return p.toFixed(3)
  return p.toExponential(1)
}

/** The corrected threshold, readable at both ends of its range. */
export function alphaText(alpha: number): string {
  if (alpha >= 0.01) return alpha.toFixed(2)
  if (alpha >= 0.001) return alpha.toFixed(4)
  return alpha.toExponential(1)
}
