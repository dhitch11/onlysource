import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildDistressedSuppliers, type DistressedSupplier } from './distressed'
import { bestRecipient } from '@/lib/sales/outreach-templates'

/**
 * THE OUTREACH DOSSIER — every measured fact a supplier email may quote, and nothing else.
 *
 * Built for one stock number: who lists stock for it (the export's availability sheet), the
 * live requirement when the corner map carries one, the last recorded award, and the
 * researched book record for the supplier being written to. The AI draft is grounded against
 * this object exactly as the memo is grounded against the package: a sentence carrying a
 * number that is not here does not survive.
 *
 * The TARGET is the holder the draft is addressed to: the first holder the supplier book can
 * actually reach (email first, then phone), else the first holder named at all. When no
 * company lists stock, there is no target and no draft; the caller says so instead.
 */

export type OutreachBookRecord = {
  cage: string
  company: string | null
  prospectTier: string | null
  lastAwardedAt: string | null
  holdsInventory: string | null
  person: string | null
  email: string | null
  phone: string | null
}

export type OutreachTarget = {
  company: string | null
  cage: string | null
  quantityListed: number | null
  book: OutreachBookRecord | null
}

export type OutreachDossier = {
  kind: 'outreach_dossier'
  nsn: string
  /** Item name from the corner map when the NSN is on it; else null, never invented. */
  item: string | null
  liveRequirement: {
    solicitation: string | null
    quantity: number | null
    unitOfIssue: string
    quoteReturnDate: string | null
  } | null
  lastAward: {
    dateIso: string | null
    unitPriceUsd: number | null
    company: string | null
    cage: string | null
  } | null
  target: OutreachTarget
  /** The other listed holders, named so the operator can widen the net by hand. */
  otherHolders: Array<{ company: string | null; cage: string | null; quantityListed: number | null; contactOnFile: boolean }>
}

export type OutreachDossierResult =
  | { ok: true; dossier: OutreachDossier }
  | { ok: false; status: 404 | 503; error: string; message: string }

function bookRecord(cage: string | null, byCage: Map<string, DistressedSupplier> | null): OutreachBookRecord | null {
  if (!cage || !byCage) return null
  const s = byCage.get(cage.toUpperCase())
  if (!s) return null
  const r = bestRecipient(s)
  return {
    cage: s.cage,
    company: s.company,
    prospectTier: s.prospectTier,
    lastAwardedAt: s.lastAwardedAt,
    holdsInventory: s.holdsInventory,
    person: r?.name ?? null,
    email: r?.email ?? null,
    phone: s.phone ?? s.contacts.find((c) => c.phone)?.phone ?? null,
  }
}

/**
 * ★ SECOND INSTANCE OF THE SAME BYPASS, found by walking every route rather than waiting for a
 * report. `/api/pursuit-package` was fixed earlier tonight; this one was not, and it is worse in
 * one respect: the route returns the WHOLE dossier in its JSON response and the email route
 * prints "Send it yourself to: {person}, {email}" in the body.
 *
 * Both outreach routes gate on `supplier.pursue`, and `supplier.pursue` is NOT sensitive, so the
 * `read_only` role holds it. The role whose sales promise is that it "never sees a supplier
 * identity" could ask for an outreach draft and be handed the supplier's name and address.
 *
 * The general rule, third time it has bitten this product: FOUR of the fourteen permissions govern
 * SEEING a fact rather than doing one, and this codebase enforces permissions at the point of
 * ACTION. A permission only ever checked before a write is not enforced on a read path.
 *
 * `mayReadIdentities` is REQUIRED and UNDEFAULTED, exactly as in `assemblePursuitPackage`: a call
 * site that forgets to resolve the permission must fail to compile rather than be the one that
 * leaks.
 */
export function buildOutreachDossier(
  nsnRaw: string,
  mayReadIdentities: boolean,
): OutreachDossierResult {
  const root = resolveDataRoot()
  if (!root.present) {
    return { ok: false, status: 503, error: 'no_data', message: 'The data directory is not mounted here.' }
  }
  const key = nsnRaw.replace(/[^0-9]/g, '')
  if (key.length < 9) {
    return { ok: false, status: 404, error: 'bad_nsn', message: 'A stock number is required.' }
  }

  const awardIx = buildNsnAwardIndex()
  const summary = awardIx.ok ? awardIx.byNsn.get(key) ?? null : null
  const holders = summary?.holders ?? []
  if (holders.length === 0) {
    return {
      ok: false,
      status: 404,
      error: 'no_holders',
      message:
        'No company lists stock for this stock number in the export, so there is nobody to draft an email to. Work the approved source or the Suppliers book instead.',
    }
  }

  const { cornerMap } = buildAllDatasets()
  const row = cornerMap.rows.find((r) => r.nsn.replace(/[^0-9]/g, '') === key) ?? null

  const book = buildDistressedSuppliers()
  const byCage = book.ok ? book.byCage : null

  const joined = holders.map((h) => ({
    company: h.company,
    cage: h.cage,
    quantityListed: h.quantity,
    book: bookRecord(h.cage, byCage),
  }))
  /*
   * ★★ THE TARGET IS CHOSEN BEFORE ANYTHING IS WITHHELD, AND THAT ORDER IS THE WHOLE POINT.
   *
   * This picks the holder to write to by who has an email, then who has a phone. Withhold the
   * identities first and both predicates go false, so the draft silently addresses `joined[0]`
   * instead — a DIFFERENT COMPANY. The permission would have changed not just what a caller sees
   * but which supplier the product decided to contact, and nothing anywhere would have said so.
   *
   * Redaction must never reach back into a decision that was already made on the full facts.
   */
  const target =
    joined.find((h) => h.book?.email) ?? joined.find((h) => h.book?.phone) ?? joined[0]!

  /*
   * Reachability is computed on the FULL records too, for the same reason and one more: a count
   * of how many companies can be reached is not an identity. Collapsing it to zero would tell an
   * operator that nobody is contactable, which is a false statement about the data rather than a
   * refusal to show a name. `/suppliers` already draws exactly this line: "Show contacts (32)" to
   * everyone, the names behind the permission.
   */
  const reachable = new Map(
    joined.map((h) => [h, Boolean(h.book && (h.book.email || h.book.phone))] as const),
  )

  /** Strip the three protected fields, keeping everything the caller may legitimately read. */
  const redact = (b: OutreachBookRecord | null): OutreachBookRecord | null =>
    b === null || mayReadIdentities ? b : { ...b, person: null, email: null, phone: null }

  const latest = summary?.latest ?? null
  const blank = (v: string | null | undefined): string | null => {
    const s = (v ?? '').trim()
    return s === '' ? null : s
  }

  return {
    ok: true,
    dossier: {
      kind: 'outreach_dossier',
      nsn: key,
      item: row ? row.nomenclature.trim() || null : null,
      liveRequirement: row
        ? {
            solicitation: blank(row.solicitation),
            quantity: row.quantity,
            unitOfIssue: row.unitOfIssue,
            quoteReturnDate: blank(row.returnDate),
          }
        : null,
      lastAward: latest
        ? {
            dateIso: latest.awardDateIso,
            // never quote a price out of a series with a decimal shift, least of all to a supplier
            unitPriceUsd: summary?.priceScaleSuspect ? null : latest.effectiveUnitPrice,
            company: latest.company,
            cage: latest.cage,
          }
        : null,
      target: { ...target, book: redact(target.book) },
      /*
       * `contactOnFile` reads the map computed above, NOT the redacted record. Recomputing it
       * here from `h.book` would be the false zero, one line after the comment explaining it.
       */
      otherHolders: joined
        .filter((h) => h !== target)
        .map((h) => ({
          company: h.company,
          cage: h.cage,
          quantityListed: h.quantityListed,
          contactOnFile: reachable.get(h) ?? false,
        })),
    },
  }
}

/**
 * MEASURED CAGE-TO-NSN FACTS for the compose draft on /suppliers.
 *
 * For each requested CAGE: the stock numbers the award index ties it to, either as a listed
 * holder (availability sheet) or as a recorded awardee, and whether each NSN is on the
 * corner map right now (an open government requirement). These are the only "we did our
 * homework" lines the buy-side draft is allowed to carry, because they are the only ones the
 * data holds. A CAGE with no tie simply has no entry, and its draft carries no such line.
 *
 * Live-requirement facts sort first, awarded before listed, capped at three per CAGE.
 */
export function supplierNsnFacts(
  cages: string[],
): Record<string, Array<{ nsn: string; kind: 'awarded' | 'lists_stock'; liveRequirement: boolean }>> {
  const awardIx = buildNsnAwardIndex()
  if (!awardIx.ok) return {}
  const wanted = new Set(cages.map((c) => c.toUpperCase()))
  const root = resolveDataRoot()
  const liveNsns = new Set<string>()
  if (root.present) {
    const { cornerMap } = buildAllDatasets()
    for (const r of cornerMap.rows) liveNsns.add(r.nsn.replace(/[^0-9]/g, ''))
  }

  const out = new Map<string, Array<{ nsn: string; kind: 'awarded' | 'lists_stock'; liveRequirement: boolean }>>()
  const push = (cage: string | null, nsn: string, kind: 'awarded' | 'lists_stock') => {
    if (!cage) return
    const key = cage.toUpperCase()
    if (!wanted.has(key)) return
    const list = out.get(key) ?? []
    if (list.some((f) => f.nsn === nsn && f.kind === kind)) return
    list.push({ nsn, kind, liveRequirement: liveNsns.has(nsn) })
    out.set(key, list)
  }
  for (const [nsn, s] of awardIx.byNsn) {
    for (const a of s.awards) push(a.cage, nsn, 'awarded')
    for (const h of s.holders) push(h.cage, nsn, 'lists_stock')
  }

  const record: Record<string, Array<{ nsn: string; kind: 'awarded' | 'lists_stock'; liveRequirement: boolean }>> = {}
  for (const [cage, facts] of out) {
    facts.sort((a, b) => {
      if (a.liveRequirement !== b.liveRequirement) return a.liveRequirement ? -1 : 1
      if (a.kind !== b.kind) return a.kind === 'awarded' ? -1 : 1
      return a.nsn.localeCompare(b.nsn)
    })
    record[cage] = facts.slice(0, 3)
  }
  return record
}

/**
 * Which of these deal refs point at a stock number with at least one listed holder?
 * Serving-path helper for the pipeline: the "Draft supplier outreach" control renders only
 * where a draft can actually be grounded. Refs come in normalized (digits and letters only).
 */
export function refsWithListedHolders(normalizedRefs: string[]): string[] {
  const awardIx = buildNsnAwardIndex()
  if (!awardIx.ok) return []
  return normalizedRefs.filter((ref) => {
    if (!/^\d{13}$/.test(ref)) return false
    const s = awardIx.byNsn.get(ref)
    return Boolean(s && s.holders.length > 0)
  })
}
