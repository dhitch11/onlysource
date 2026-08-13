/**
 * THE KEY. Every shared national table in this product keys on NIIN, nine digits, never the
 * full NSN, because the supply class can change while the item does not. House law, T1
 * schema law, and the single most common modelling error in this domain.
 *
 * This file exists because the seed data proves the problem is not theoretical. Inside ONE
 * seed workbook the same item appears as `6530-00-299-8353` in the `nsn` column and as
 * `6530/00/299/8353` in the `supplier_alt_part_number` column. A join on either raw string
 * finds nothing. A join on the NIIN finds it every time.
 *
 * Nothing here guesses. An input that is not an NSN or a NIIN returns a null result with a
 * named reason, and the caller decides whether that is an abstention or a defect.
 */

/** 4 digit federal supply class. A classification of the item, not an identifier of it. */
export type Fsc = string

/** 9 digit national item identification number. THE key. */
export type Niin = string

export type ParsedNsn = {
  niin: Niin
  /** Present only when the input carried one. A NIIN alone is complete and valid. */
  fsc: Fsc | null
  /** National codification bureau, the two digits after the class. Country of CATALOGING. */
  ncb: string
  /** The input exactly as received, so an evidence row can show what was actually read. */
  raw: string
}

export type NsnParseFailure = {
  raw: string
  reason: 'empty' | 'wrong_length' | 'non_numeric'
}

const DIGITS_ONLY = /^\d+$/

/**
 * Strip the separators the wild uses. Hyphens, slashes, spaces and dots all appear.
 * Deliberately does NOT strip letters: a part number is not an NSN and must fail, loudly,
 * rather than be coerced into one by discarding characters.
 */
function stripSeparators(input: string): string {
  return input.replace(/[-/\s.]/g, '')
}

/**
 * Parse an NSN or a bare NIIN into the canonical key.
 *
 * Accepts 13 digits (full NSN, class + NIIN) or 9 digits (NIIN alone), with or without
 * separators. Returns null on anything else rather than a partial or a guess.
 */
export function parseNsn(input: string | null | undefined): ParsedNsn | null {
  if (input == null) return null
  const raw = String(input).trim()
  if (raw === '') return null

  const bare = stripSeparators(raw)
  if (!DIGITS_ONLY.test(bare)) return null

  if (bare.length === 13) {
    const fsc = bare.slice(0, 4)
    const niin = bare.slice(4)
    return { niin, fsc, ncb: niin.slice(0, 2), raw }
  }
  if (bare.length === 9) {
    return { niin: bare, fsc: null, ncb: bare.slice(0, 2), raw }
  }
  return null
}

/** Same as parseNsn but reports WHY it failed. Use where the caller writes a gap. */
export function parseNsnWithReason(
  input: string | null | undefined,
): { ok: true; value: ParsedNsn } | { ok: false; failure: NsnParseFailure } {
  const raw = input == null ? '' : String(input).trim()
  if (raw === '') return { ok: false, failure: { raw, reason: 'empty' } }
  const bare = stripSeparators(raw)
  if (!DIGITS_ONLY.test(bare)) return { ok: false, failure: { raw, reason: 'non_numeric' } }
  if (bare.length !== 9 && bare.length !== 13) {
    return { ok: false, failure: { raw, reason: 'wrong_length' } }
  }
  const parsed = parseNsn(raw)
  if (!parsed) return { ok: false, failure: { raw, reason: 'wrong_length' } }
  return { ok: true, value: parsed }
}

/** The canonical key for every shared table. Throws rather than return a wrong key. */
export function toNiin(input: string): Niin {
  const parsed = parseNsn(input)
  if (!parsed) throw new Error(`niin: cannot parse "${input}" as an NSN or NIIN`)
  return parsed.niin
}

/** Display form, `1234-56-789-0123`. Display only. Never a join key. */
export function formatNsn(fsc: Fsc, niin: Niin): string {
  return `${fsc}-${niin.slice(0, 2)}-${niin.slice(2, 5)}-${niin.slice(5)}`
}

/**
 * The United States has TWO live codification bureau codes, 00 and 01. Any check that
 * accepts only one silently drops half the domestic catalog.
 */
export const US_NCB_CODES = ['00', '01'] as const

export function isUnitedStatesNcb(ncb: string): boolean {
  return (US_NCB_CODES as readonly string[]).includes(ncb)
}

/**
 * A company code (CAGE) is 5 alphanumeric characters. Names drift under a stable code, which
 * is why every join in this lane keys on the code and resolves the name only for display.
 */
export type Cage = string

const CAGE_SHAPE = /^[A-Z0-9]{5}$/

export function parseCage(input: string | null | undefined): Cage | null {
  if (input == null) return null
  const raw = String(input).trim().toUpperCase()
  return CAGE_SHAPE.test(raw) ? raw : null
}

/**
 * The ninth character of a solicitation number decides whether an alternate offer can win
 * the instant buy or only qualifies the company for future requirements. `T` and `U` mark
 * the automated path, where an alternate offer CANNOT win the current buy.
 *
 * The seed data carries both spellings of the same number, `SPE4A5-26-T-8786` with
 * separators and `SPE2DH26T2029` without, so the character is located after stripping.
 */
export type SolicitationForm = {
  raw: string
  normalized: string
  ninthCharacter: string | null
  /** True when the ninth character is T or U. An alternate offer cannot win the instant buy. */
  automated: boolean | null
}

export function parseSolicitation(input: string | null | undefined): SolicitationForm | null {
  if (input == null) return null
  const raw = String(input).trim().toUpperCase()
  if (raw === '') return null
  const normalized = raw.replace(/[-\s]/g, '')
  if (normalized.length < 9) {
    return { raw, normalized, ninthCharacter: null, automated: null }
  }
  const ninth = normalized.charAt(8)
  return {
    raw,
    normalized,
    ninthCharacter: ninth,
    automated: ninth === 'T' || ninth === 'U',
  }
}
