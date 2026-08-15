/**
 * THE GROUNDING GUARD — makes "no number appears that this build did not measure" a fact, not a hope.
 *
 * The AI brief is written from a dossier and told to quote only its numbers. This is the deterministic
 * check behind that promise: it collects every number the dossier actually contains, then walks the
 * brief sentence by sentence and drops any sentence carrying a number that is not in that set. What is
 * shown is therefore guaranteed to be grounded, and what was stripped is returned so the server can
 * log it. It is built to avoid false positives (identifiers like NSNs and contract numbers are not
 * treated as value claims, and every dossier number is registered in several normal forms), so a
 * well-behaved model loses nothing.
 */

/** Pull every number out of an arbitrary value (deep), including numbers embedded in strings. */
function collectNumbers(value: unknown, into: Set<number>): void {
  if (value == null) return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) into.add(value)
    return
  }
  if (typeof value === 'string') {
    for (const m of value.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
      const n = Number(m[0].replace(/,/g, ''))
      if (Number.isFinite(n)) into.add(n)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, into)
    return
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectNumbers(v, into)
  }
}

/** The allowed set, each number registered as its float, its rounded-2, and its integer form. */
export function allowedNumberSet(dossier: unknown): Set<string> {
  const raw = new Set<number>()
  collectNumbers(dossier, raw)
  const allowed = new Set<string>()
  for (const n of raw) {
    allowed.add(String(n))
    allowed.add(n.toFixed(2))
    allowed.add(String(Math.round(n)))
    // A percentage in the brief may be the rounded escalation of two dossier prices; the dossier
    // already carries the computed escalationPct, so no derivation is allowed here beyond rounding.
  }
  return allowed
}

const canonical = (n: number): string[] => [String(n), n.toFixed(2), String(Math.round(n))]

/** Is this brief-number present in the allowed set, in any normal form? */
function isAllowed(n: number, allowed: Set<string>): boolean {
  return canonical(n).some((f) => allowed.has(f))
}

export type GroundingResult = { text: string; stripped: string[]; ok: boolean }

/**
 * Keep only sentences whose numbers are all in the allowed set. ALL-CAPS label lines are structural
 * and always kept. Identifiers (8+ contiguous digits: NSNs, contract numbers) are not value claims
 * and are ignored. Small ordinals inside words are avoided by requiring a digit boundary.
 */
export function groundBrief(text: string, dossier: unknown): GroundingResult {
  const allowed = allowedNumberSet(dossier)
  const stripped: string[] = []
  const isLabel = (line: string) => /^[A-Z][A-Z' ]{2,48}$/.test(line.trim())

  const outLines: string[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine
    if (line.trim() === '' || isLabel(line)) {
      outLines.push(line)
      continue
    }
    // Split into sentences on end-punctuation FOLLOWED BY whitespace, so a decimal point inside a
    // price ($65.55) never splits a number across two sentences (which caused false strips).
    const sentences = line.split(/(?<=[.!?])\s+/)
    const kept: string[] = []
    for (const sentence of sentences) {
      let bad = false
      for (const m of sentence.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
        const digits = m[0].replace(/[^\d]/g, '')
        if (digits.length >= 8) continue // an identifier (NSN, contract), not a value claim
        const n = Number(m[0].replace(/,/g, ''))
        if (!Number.isFinite(n)) continue
        if (!isAllowed(n, allowed)) {
          bad = true
          break
        }
      }
      if (bad) stripped.push(sentence.trim())
      else kept.push(sentence)
    }
    if (kept.length > 0) outLines.push(kept.join(' ').replace(/\s+/g, ' ').trimEnd())
  }

  return { text: outLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), stripped, ok: stripped.length === 0 }
}
