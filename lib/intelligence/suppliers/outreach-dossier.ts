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

export function buildOutreachDossier(nsnRaw: string): OutreachDossierResult {
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
  const target =
    joined.find((h) => h.book?.email) ?? joined.find((h) => h.book?.phone) ?? joined[0]!

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
            unitPriceUsd: latest.effectiveUnitPrice,
            company: latest.company,
            cage: latest.cage,
          }
        : null,
      target,
      otherHolders: joined
        .filter((h) => h !== target)
        .map((h) => ({
          company: h.company,
          cage: h.cage,
          quantityListed: h.quantityListed,
          contactOnFile: Boolean(h.book && (h.book.email || h.book.phone)),
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
