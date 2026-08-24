/**
 * CORPORATE FAMILY RESOLUTION FOR CAGE CODES.
 *
 * ==========================================================================================
 * THE DEFECT THIS EXISTS FOR
 * ==========================================================================================
 * The award-silence leg added +15 when "the approved source has no recorded prime award in two
 * years". It compared ONE CAGE STRING. On NSN 5340-01-608-5969 the approved source is CAGE
 * 49956, RAYTHEON COMPANY DIV CORP of Arlington VA, the registration that HOLDS THE DRAWING and
 * never contracts. All seven award rows went to CAGE 54X10, RAYTHEON COMPANY of Fairdale KY,
 * THE PLANT. The maker never went silent. The row scored 82 with +15 for a silence that did not
 * happen, and simultaneously scored +10 for "every one of 6 past awards went to a single company
 * (54X10)" - two legs that contradict each other the moment you know both CAGEs are Raytheon.
 *
 * A registration is not a plant, and two things sharing a name are not the same thing. The
 * converse is what bit us: two things NOT sharing a CAGE string can be the same company.
 *
 * ==========================================================================================
 * THE ALGORITHM, IN PRIORITY ORDER, AND WHY EACH LEG IS SHAPED THE WAY IT IS
 * ==========================================================================================
 * 1. THE H-SERIES CORPORATE ROLLUP, AND IT IS AUTHORITATIVE. `data/flis/cage-index.json`
 *    carries an `associations` array derived from `H-SERIES.zip::V_H5_CORPORATE.CSV` (119,076
 *    source rows). Each entry links a CAGE to an associated CAGE with an affiliation letter.
 *
 *    ★ IT IS A GRAPH, NOT A LOOKUP, and that distinction is load-bearing. Measured:
 *        54X10 -> association 49956, affiliation S   (the plant points at the registration)
 *        49956 -> association 61858, affiliation P   (the registration points at the parent)
 *    A single lookup on 54X10 finds 49956 and a single lookup on 49956 finds 61858, so a
 *    one-hop comparison would say they are different. The TRANSITIVE CLOSURE puts both at root
 *    61858, which is RTX: the family of 300 contains RAYTHEON COMPANY (45 CAGEs), Rockwell
 *    Collins, Goodrich, Hamilton Sundstrand and RTX BBN, which is the real corporate structure.
 *
 *    Measured shape of the closure over 13,275 nodes: 1,366 components, 613 of them pairs, the
 *    largest 2,928. That largest one was checked rather than assumed, and it is legitimately one
 *    company (Sherwin-Williams and its stores). The closure is not degenerate.
 *
 * 2. NORMALISED NAME, AS A FALLBACK ONLY, AND ONLY WHERE THE ROLLUP CANNOT ANSWER.
 *    ★ THE NAME LEG MAY NEVER OVERRIDE A ROLLUP NEGATIVE. If both CAGEs carry rollup edges and
 *    land in different components, the authoritative source has spoken and two similar names do
 *    not outvote it. The fallback applies only when at least one CAGE has no edge at all
 *    (5,531 of the 18,748 registered CAGEs).
 *
 *    ⛔ THAT FIGURE IS 5,531 AND NOT 5,473. THE OBVIOUS SUBTRACTION IS THE WRONG ONE.
 *    18,748 - 13,275 = 5,473 subtracts two DIFFERENT POPULATIONS. The 13,275 is the closure
 *    node count, and 58 of those nodes appear only as an association TARGET and were never in
 *    `companies[]` at all (3813A, 5XPX9, 79WV9, 8N273 among them). The registered CAGEs that
 *    actually carry an edge number 13,217, so the unedged remainder is 18,748 - 13,217 = 5,531.
 *    The executable path is `parent.has(cage)` per CAGE and was always correct; only this
 *    published figure was wrong. Re-measured against the live index 2026-08-24, counting exactly
 *    what the loop below counts: self-edges skipped (1,180 of the 13,089 association rows) and
 *    empty targets skipped, leaving 11,909 real unions.
 *
 *    The normalisation is written out rather than left to intuition: uppercase, strip
 *    punctuation, collapse whitespace, strip the suffix list AS WHOLE TRAILING TOKENS, then
 *    require the same first token AND one token list to be a prefix of the other.
 *    "RAYTHEON COMPANY DIV CORP" -> ["RAYTHEON"], "RAYTHEON COMPANY" -> ["RAYTHEON"]: match.
 *    Exact string matching would have FAILED on exactly the pair that caused this defect, which
 *    is why the rule is pinned here instead of being rediscovered.
 *
 *    ⛔ NO SUBSTRING MATCHING ON RAW NAMES, EVER. This estate has already been burned by a
 *    `%dent%` filter matching INDEPENDENT while hunting dental practices.
 *
 * 3. A GENERIC-TOKEN STOPLIST, DERIVED FROM THE INDEX RATHER THAN GUESSED. A first token that
 *    begins more than 50 distinct rollup families is generic and the name leg abstains on it.
 *    Derived 2026-08-24 from cage-index.json: exactly two qualify, THE (92 families) and
 *    AMERICAN (55). It is derived at load time, not hardcoded, so it tracks the index.
 *
 * ==========================================================================================
 * THE THREE-STATE VERDICT, AND WHY IT IS NOT A BOOLEAN
 * ==========================================================================================
 * A boolean would force "we cannot tell" to be spelled either `true` or `false`, and for the
 * silence leg `false` MEANS "pay the +15". A CAGE we cannot ground would then be paid exactly
 * like a CAGE we checked. So the verdict is tri-state and the ungrounded case is its own value
 * a caller cannot mistake for a negative. A signal you cannot ground is a signal you do not pay.
 */

/** What the index could establish about one CAGE. */
export type FamilyResolution =
  /** In the index and inside a corporate rollup component. `family` is the component root. */
  | { state: 'rollup'; family: string }
  /** Registered, but carrying no rollup edge at all. Its own family of one, name leg eligible. */
  | { state: 'solo'; family: string; name: string | null }
  /** Not in the index. Nothing may be concluded, and nothing may be paid. */
  | { state: 'absent' }

/**
 * ★ THREE STATES, NOT TWO. `ungrounded` is not `different_families`, and a caller that treats
 * them the same has reintroduced the defect for the rows it understands least.
 */
export type FamilyVerdict = 'same_family' | 'different_families' | 'ungrounded'

export type SameFamilyAnswer = {
  verdict: FamilyVerdict
  /** Which leg answered, so a wrong answer is traceable to the rule that produced it. */
  basis:
    | 'identical_cage'
    | 'rollup_match'
    | 'rollup_distinct'
    | 'name_match'
    | 'name_distinct'
    | 'name_abstained_generic_token'
    | 'cage_absent_from_index'
  /** One sentence, suitable for a log line or an operator-facing explanation. */
  detail: string
}

export type CageFamilyIndex = {
  resolve(cage: string | null | undefined): FamilyResolution
  sameFamily(a: string | null | undefined, b: string | null | undefined): SameFamilyAnswer
  /** Registered CAGEs. */
  readonly companies: number
  /** Distinct rollup components. */
  readonly families: number
  /** The derived generic first-token stoplist, exposed so a test can assert what it derived. */
  readonly genericTokens: readonly string[]
}

/** Suffixes stripped as WHOLE TRAILING TOKENS. Never as substrings. */
export const NAME_SUFFIX_TOKENS: readonly string[] = [
  'INC', 'LLC', 'CORP', 'CO', 'COMPANY', 'LTD', 'LP', 'DIV', 'DIVISION', 'GROUP', 'HOLDINGS',
]

/** A first token beginning more than this many distinct families is generic and abstains. */
export const GENERIC_TOKEN_FAMILY_THRESHOLD = 50

/**
 * Uppercase, strip punctuation, collapse whitespace, drop trailing suffix tokens.
 * Exported so its truth table is inspectable in a test rather than inferred from behaviour.
 */
export function normaliseCompanyTokens(name: string | null | undefined): string[] {
  const tokens = (name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
  while (tokens.length > 0 && NAME_SUFFIX_TOKENS.includes(tokens[tokens.length - 1] as string)) {
    tokens.pop()
  }
  return tokens
}

/** Same first token AND one list is a token-prefix of the other. Never a substring test. */
export function namesArePrefixCompatible(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  if (a[0] !== b[0]) return false
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  return shorter.every((t, i) => t === longer[i])
}

export type CageIndexShape = {
  companies: Array<{ cage: string; company: string | null }>
  associations: Array<{ cage: string; association: string; affiliation?: string }>
}

/**
 * Build the resolver from an already-parsed cage index. Pure: no I/O, so it is trivially
 * testable against a hand-built index as well as the real 4MB one.
 */
export function buildCageFamilyIndex(index: CageIndexShape): CageFamilyIndex {
  const nameOf = new Map<string, string | null>()
  for (const c of index.companies) nameOf.set(c.cage, c.company ?? null)

  // Transitive closure over the association graph, union by path-halving.
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while ((parent.get(r) ?? r) !== r) {
      const g = parent.get(parent.get(r) as string) as string
      parent.set(r, g)
      r = g
    }
    return r
  }
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a)
    if (!parent.has(b)) parent.set(b, b)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const a of index.associations) {
    if (!a.cage || !a.association || a.cage === a.association) continue
    union(a.cage, a.association)
  }

  // Derive the generic-token stoplist FROM THE INDEX, so it tracks the data rather than a memory.
  const familiesPerToken = new Map<string, Set<string>>()
  for (const c of index.companies) {
    const t = normaliseCompanyTokens(c.company)[0]
    if (!t) continue
    const root = parent.has(c.cage) ? find(c.cage) : `solo:${c.cage}`
    const set = familiesPerToken.get(t) ?? new Set<string>()
    set.add(root)
    familiesPerToken.set(t, set)
  }
  const genericTokens = [...familiesPerToken]
    .filter(([, s]) => s.size > GENERIC_TOKEN_FAMILY_THRESHOLD)
    .map(([t]) => t)
    .sort()
  const generic = new Set(genericTokens)

  const roots = new Set<string>()
  for (const k of parent.keys()) roots.add(find(k))

  const norm = (c: string | null | undefined) => (c ?? '').trim().toUpperCase()

  const resolve = (cage: string | null | undefined): FamilyResolution => {
    const c = norm(cage)
    if (c === '' || !nameOf.has(c)) return { state: 'absent' }
    if (parent.has(c)) return { state: 'rollup', family: find(c) }
    return { state: 'solo', family: `solo:${c}`, name: nameOf.get(c) ?? null }
  }

  const sameFamily = (a: string | null | undefined, b: string | null | undefined): SameFamilyAnswer => {
    const ca = norm(a)
    const cb = norm(b)
    if (ca !== '' && ca === cb) {
      return { verdict: 'same_family', basis: 'identical_cage', detail: `CAGE ${ca} is the same registration` }
    }
    const ra = resolve(ca)
    const rb = resolve(cb)
    if (ra.state === 'absent' || rb.state === 'absent') {
      const missing = ra.state === 'absent' ? ca || '(blank)' : cb || '(blank)'
      return {
        verdict: 'ungrounded',
        basis: 'cage_absent_from_index',
        detail: `CAGE ${missing} is absent from cage-index, so corporate family cannot be established`,
      }
    }
    if (ra.state === 'rollup' && rb.state === 'rollup') {
      // The authoritative leg answers BOTH ways. A name similarity does not outvote it.
      return ra.family === rb.family
        ? { verdict: 'same_family', basis: 'rollup_match', detail: `both CAGEs roll up to corporate family ${ra.family}` }
        : {
            verdict: 'different_families',
            basis: 'rollup_distinct',
            detail: `the corporate rollup places ${ca} in family ${ra.family} and ${cb} in family ${rb.family}`,
          }
    }
    // At least one CAGE carries no rollup edge. Only here does the name leg apply.
    const ta = normaliseCompanyTokens(nameOf.get(ca) ?? null)
    const tb = normaliseCompanyTokens(nameOf.get(cb) ?? null)
    if (ta.length === 0 || tb.length === 0) {
      return {
        verdict: 'ungrounded',
        basis: 'cage_absent_from_index',
        detail: `no usable company name for ${ta.length === 0 ? ca : cb}, so the name fallback cannot run`,
      }
    }
    if (generic.has(ta[0] as string) || generic.has(tb[0] as string)) {
      return {
        verdict: 'ungrounded',
        basis: 'name_abstained_generic_token',
        detail: `"${ta[0]}" begins more than ${GENERIC_TOKEN_FAMILY_THRESHOLD} distinct corporate families, so the name fallback abstains`,
      }
    }
    return namesArePrefixCompatible(ta, tb)
      ? { verdict: 'same_family', basis: 'name_match', detail: `"${ta.join(' ')}" and "${tb.join(' ')}" normalise to one leading name` }
      : { verdict: 'different_families', basis: 'name_distinct', detail: `"${ta.join(' ')}" and "${tb.join(' ')}" are distinct normalised names` }
  }

  return {
    resolve,
    sameFamily,
    companies: index.companies.length,
    families: roots.size,
    genericTokens,
  }
}
