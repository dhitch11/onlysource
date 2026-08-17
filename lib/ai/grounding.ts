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
 *
 * -------------------------------------------------------------------------------------------
 * THE TOKENIZER IS SHARED BETWEEN BOTH SIDES, AND BOUNDARY-AWARE. MEASURED REASON:
 * -------------------------------------------------------------------------------------------
 * The allowed set used to harvest EVERY digit run in every dossier string, so an end item named
 * "MIDS JTRS AN/USQ190" quietly blessed the bare number 190, and a live portfolio brief served
 * "recorded escalation above 190 percent" — a figure no file ever measured — through the guard.
 * A digit run that abuts a letter is part of an identifier, not a figure, so it neither enters
 * the allowed set nor reads as a value claim in the brief. Because BOTH sides use the same rule,
 * a brief may still quote "AN/USQ190" verbatim without a false strip. Hyphen chains hanging off
 * letters or digits (B-52, 2025-10-31, part 04-21993-00415) are identifier fragments too: the
 * date contributes its year only, and "31 units" cannot ride in on a date's day-of-month.
 */

const NUMBER_RUN = /-?\d[\d,]*(?:\.\d+)?/g

type ValueToken = { raw: string; n: number }

/** The digit runs in a string that read as VALUE claims, not identifier fragments. */
export function valueTokensIn(text: string): ValueToken[] {
  const out: ValueToken[] = []
  for (const m of text.matchAll(NUMBER_RUN)) {
    const start = m.index ?? 0
    const before = start > 0 ? text[start - 1]! : ''
    const after = start + m[0].length < text.length ? text[start + m[0].length]! : ''
    // Abutting a letter or digit on the left (USQ190; or the "-10" inside 2025-10-31, whose
    // match begins at a hyphen preceded by a digit) or a letter on the right (190x) marks an
    // identifier fragment. A '%' or '$' or space or parenthesis is a normal value boundary.
    if (/[A-Za-z0-9]/.test(before) || /[A-Za-z]/.test(after)) continue
    const n = Number(m[0].replace(/,/g, ''))
    if (!Number.isFinite(n)) continue
    out.push({ raw: m[0], n })
  }
  return out
}

/** Pull every number out of an arbitrary value (deep), including value-shaped numbers in strings. */
function collectNumbers(value: unknown, into: Set<number>): void {
  if (value == null) return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) into.add(value)
    return
  }
  if (typeof value === 'string') {
    for (const t of valueTokensIn(value)) into.add(t.n)
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

/*
 * Numbers can be written in WORDS, which no digit scan sees. The dossier always carries its
 * figures as digits and every prompt requires quoting them exactly, so a spelled-out magnitude
 * ("three hundred awards") or a multiplicative claim ("the price doubled") cannot be a dossier
 * quote — it is a derived or invented figure by construction, and the sentence carrying it is
 * withheld. The list is deliberately narrow (magnitudes and multiplicatives, never "one" or
 * "first") so ordinary prose is untouched.
 */
const NUMBER_WORDS =
  /\b(?:hundred|thousand|million|billion|trillion|doubled|tripled|quadrupled|halved|twofold|threefold|fourfold|fivefold|tenfold|hundredfold)\b/i

export type GroundingResult = { text: string; stripped: string[]; ok: boolean }

/**
 * Keep only sentences whose numbers are all in the allowed set. ALL-CAPS label lines are structural
 * and always kept. Identifiers (8+ contiguous digits: NSNs, contract numbers) are not value claims
 * and are ignored, as are digit runs embedded in lettered designators (see the tokenizer above).
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
      let bad = NUMBER_WORDS.test(sentence)
      if (!bad) {
        for (const t of valueTokensIn(sentence)) {
          const digits = t.raw.replace(/[^\d]/g, '')
          if (digits.length >= 8) continue // an identifier (NSN, contract), not a value claim
          if (!isAllowed(t.n, allowed)) {
            bad = true
            break
          }
        }
      }
      if (bad) stripped.push(sentence.trim())
      else kept.push(sentence)
    }
    if (kept.length > 0) outLines.push(kept.join(' ').replace(/\s+/g, ' ').trimEnd())
  }

  return { text: outLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), stripped, ok: stripped.length === 0 }
}
