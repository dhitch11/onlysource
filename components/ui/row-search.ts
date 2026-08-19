/**
 * ROW SEARCH: one matcher, used by every grid in the product.
 *
 * ==========================================================================================
 * WHY THIS IS A MODULE AND NOT THREE COPIES OF A `.includes()`.
 * ==========================================================================================
 * Four surfaces render a `DataGrid` over lists an operator has to find one row in: /suppliers
 * (3,471 firms), /board (1,363 rows), /pricing (1,201) and /monopoly. Until this landed NONE of
 * them had a search box, and the natural repair — a `filter` beside each one — is how two grids
 * come to disagree about whether "acme ohio" means "acme AND ohio" or "the literal string".
 *
 * The rule this file encodes, once:
 *
 *   EVERY TERM MUST MATCH, IN ANY FIELD, IN ANY ORDER. So a second word always narrows. A
 *   substring match on the raw query would make "acme ohio" match nothing unless the operator
 *   typed the fields in the order the row happens to store them, which nobody can know.
 *
 *   NO TERM MAY STRADDLE TWO FIELDS. Fields are joined with a separator no query can contain,
 *   so a company called "ACME CLEVE" in a city called "Land" does not answer a search for
 *   "cleveland". That match is unexplainable, and it appears in a list somebody is deciding who
 *   to telephone from.
 *
 * WHAT DOES NOT BELONG IN A HAYSTACK, stated here because the temptation is at every call site:
 * scores, tiers, statuses and other small enumerations. They are FILTERS. Folding "Manufacturer"
 * into the searchable text makes a search for "manufacturer" return every stocking firm, which
 * turns a lookup into a second and worse copy of the tab bar directly above it.
 */

/**
 * The separator between fields inside a haystack.
 *
 * A NUL. It cannot be typed into an `<input>`, cannot survive a copy-paste out of a spreadsheet,
 * and does not occur in any government export this product reads — so no query can ever bridge
 * two fields through it. A space would not do: plenty of real terms contain one.
 */
export const FIELD_SEP = '\u0000'

/** Join a row's searchable fields into one lower-cased haystack. Nulls become empty, not "null". */
export function haystackOf(fields: ReadonlyArray<string | null | undefined>): string {
  return fields.map((f) => f ?? '').join(FIELD_SEP).toLowerCase()
}

/**
 * Split a query into terms.
 *
 * Lower-cased here rather than at each comparison so the cost is paid once per keystroke instead
 * of once per row per term. On the supplier book that is the difference between 3 comparisons and
 * roughly ten thousand.
 */
export function termsOf(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
}

/**
 * Does this haystack carry every term?
 *
 * An empty term list matches everything, deliberately: it is what an empty box means, and making
 * "no query" a special case at every call site is how one of them forgets and shows nothing.
 */
export function matchesTerms(haystack: string, terms: readonly string[]): boolean {
  for (const t of terms) if (!haystack.includes(t)) return false
  return true
}
