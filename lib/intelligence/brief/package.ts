import type { CornerRow } from '@/lib/intelligence/corner'
import type { NsnAwardSummary } from '@/lib/intelligence/awards/nsn-now'
import type { DistressedSupplier } from '@/lib/intelligence/suppliers/distressed'
import { bestRecipient } from '@/lib/sales/outreach-templates'
/*
 * TYPE ONLY, AND IT MATTERS. `dossier-eligibility` reads the acquisition-code index off disk, so
 * it imports `node:fs`. This module is imported by a client component (the panel calls
 * `packageMarkdown` to build the download), and a value import would drag `node:fs` into the
 * browser bundle. The verdict is therefore resolved by the caller and handed in.
 */
import type { PackageEligibility } from '@/lib/intelligence/eligibility/dossier-eligibility'
import type { CornerDossier } from './dossier'

/**
 * THE PURSUIT PACKAGE — everything the product holds about ONE deal, assembled by the
 * engine, never by a model.
 *
 * The corner dossier answers "is this a corner". The pursuit package answers the next three
 * questions a person with money asks: WHAT IS IT WORTH (modeled economics, with the basis
 * stated), WHO HOLDS THE ARTICLE (availability holders, approved sources and past awardees,
 * joined to the researched supplier book by CAGE), and WHAT IS STILL UNKNOWN (the named
 * gaps). The AI memo is written FROM this object and may quote nothing outside it, which is
 * what lets the memo lawfully state the modeled value: the number is computed here,
 * deterministically, with its arithmetic written next to it.
 *
 * Every field is measured or null. A supplier with no contact on file says so. Availability
 * is "listed", never "confirmed": the holder self-reports and nothing here has seen a shelf.
 */

export type PackageBookContact = {
  cage: string
  company: string | null
  prospectTier: string | null
  lastAwardedAt: string | null
  holdsInventory: string | null
  /** The person the email address belongs to, when the book can say. Never a name from another row. */
  person: string | null
  email: string | null
  phone: string | null
}

export type PackageHolder = {
  company: string | null
  cage: string | null
  /** Units listed in the export. Self-reported, never confirmed. */
  quantityListed: number | null
  /** The researched book record for this CAGE, when one exists. */
  inBook: PackageBookContact | null
}

export type PackageApprovedSource = {
  cage: string | null
  company: string | null
  partNumber: string | null
  inBook: PackageBookContact | null
}

export type PackagePastAwardee = {
  cage: string
  company: string | null
  /** The most recent award this CAGE took on THIS stock number. */
  lastAwardDateIso: string | null
  inBook: PackageBookContact | null
}

export type PursuitPackage = {
  kind: 'pursuit_package'
  nsn: string
  item: string
  /** The full corner dossier, unchanged. The memo may quote any of it. */
  dossier: CornerDossier
  /**
   * MAY THE OPERATOR BID. A first-class field, not an appendix.
   *
   * It is here because the memo and the panel must read ONE object: an eligibility fact that
   * lives only on the triage screen is a fact the person committing money never sees. The memo
   * is generated from this package and may quote nothing outside it, so putting the verdict in
   * the package is what lets the memo state it at all. `kind` discriminates a resolved verdict
   * from a caller that never looked, and neither of them ever reads as "unrestricted".
   */
  eligibility: PackageEligibility
  /** The live requirement this feed day, when the row carries one. */
  requirement: {
    solicitation: string | null
    quoteReturnDate: string | null
    quantity: number | null
    unitOfIssue: string
  }
  /**
   * DETERMINISTIC ECONOMICS, WITH THE BASIS STATED. The one number a partner or a lender
   * asks first. Computed here (never by the model), and null with a stated reason when
   * either leg is unread. A model of the size of the buy, not a quote.
   */
  economics: {
    modeledBuyValueUsd: number | null
    quantity: number | null
    lastAwardUnitPriceUsd: number | null
    lastAwardDateIso: string | null
    /** The arithmetic in words, or the reason there is no figure. */
    basis: string
  }
  suppliers: {
    /** Companies listing stock for this NSN in the export. Listed, not confirmed. */
    holders: PackageHolder[]
    approvedSources: PackageApprovedSource[]
    /** Distinct CAGEs on the recorded award history for this NSN. */
    pastAwardees: PackagePastAwardee[]
    /** DISTINCT CAGEs above with at least one contact channel on file. Distinct companies,
     *  never rows: one contactable CAGE spanning two part-number rows is ONE supplier to
     *  reach, and the memo's "reach the N suppliers" sentence quotes this number. */
    contactChannelsOnFile: number
  }
  /** Saved quote packets for this NSN in Documents. The traceability read lives there. */
  documents: { savedPacketCount: number }
  /** Named, never empty by omission: what this package does not establish. */
  gaps: string[]
  /** Honest, deterministic next steps. DIBBS filing is the operator's, always. */
  nextSteps: string[]
}

const usd = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function bookContact(cage: string | null, byCage: Map<string, DistressedSupplier> | null): PackageBookContact | null {
  if (!cage || !byCage) return null
  const s = byCage.get(cage.toUpperCase())
  if (!s) return null
  const recipient = bestRecipient(s)
  return {
    cage: s.cage,
    company: s.company,
    prospectTier: s.prospectTier,
    lastAwardedAt: s.lastAwardedAt,
    holdsInventory: s.holdsInventory,
    person: recipient?.name ?? null,
    email: recipient?.email ?? null,
    phone: s.phone ?? s.contacts.find((c) => c.phone)?.phone ?? null,
  }
}

const blank = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}

export function buildPursuitPackage(args: {
  row: CornerRow
  dossier: CornerDossier
  award: NsnAwardSummary | null
  /** The distressed book's CAGE index, or null when the book is not on disk. */
  byCage: Map<string, DistressedSupplier> | null
  savedPacketCount: number
  /**
   * The eligibility verdict, resolved by the caller because this module cannot read a file (see
   * the type-only import at the top). Omitting it does not produce a permissive default: the
   * package carries `ELIGIBILITY_NOT_RESOLVED`, whose every sentence says the lookup did not run.
   */
  eligibility?: PackageEligibility
}): PursuitPackage {
  const { row, dossier, award, byCage, savedPacketCount } = args
  /*
   * Spelled out rather than imported, because importing the constant would make this a value
   * import of a module that reads the filesystem. Same shape, same words, and the type checker
   * holds them to the same contract.
   */
  const eligibility: PackageEligibility = args.eligibility ?? {
    kind: 'eligibility_not_resolved',
    sentence:
      'Bid eligibility was not resolved for this package: the acquisition codes were not looked up. ' +
      'Nothing here says whether an approved source is required, and this is not a finding that the ' +
      'item is unrestricted.',
  }

  // ---- economics: quantity x the last recorded award unit price, or an honest null ----
  const quantity = row.quantity
  const lastUnit = award?.latest?.effectiveUnitPrice ?? null
  const lastDate = award?.latest?.awardDateIso ?? null
  const modeled =
    quantity != null && lastUnit != null && lastUnit > 0
      ? Math.round(quantity * lastUnit * 100) / 100
      : null
  const basis =
    modeled != null
      ? `Modeled buy value $${usd(modeled)} = ${quantity?.toLocaleString('en-US')} units x $${usd(lastUnit as number)}, ` +
        `the last recorded award unit price${lastDate ? ` (${lastDate})` : ''}. ` +
        'A model of the size of the buy, not a quote and not a promise.'
      : quantity == null && lastUnit == null
        ? 'No modeled value: neither the requirement quantity nor an award unit price is on record. Nothing is estimated in their place.'
        : quantity == null
          ? 'No modeled value: the requirement quantity is not on record. Nothing is estimated in its place.'
          : 'No modeled value: no award unit price is on record for this stock number. Nothing is estimated in its place.'

  // ---- suppliers: three deterministic joins, book contact where the CAGE matches ----
  const holders: PackageHolder[] = (award?.holders ?? []).map((h) => ({
    company: h.company,
    cage: h.cage,
    quantityListed: h.quantity,
    inBook: bookContact(h.cage, byCage),
  }))

  const approvedSources: PackageApprovedSource[] =
    award && award.approvedSources.length > 0
      ? award.approvedSources.map((s) => ({
          cage: s.cage,
          company: s.company,
          partNumber: s.partNumber,
          inBook: bookContact(s.cage, byCage),
        }))
      : row.approvedSources.map((cage) => ({
          cage,
          company: null,
          partNumber: null,
          inBook: bookContact(cage, byCage),
        }))

  const awardeeLatest = new Map<string, { company: string | null; dateIso: string | null }>()
  for (const a of award?.awards ?? []) {
    if (!a.cage) continue
    const key = a.cage.toUpperCase()
    const prev = awardeeLatest.get(key)
    if (!prev || (a.awardDateIso ?? '') > (prev.dateIso ?? '')) {
      awardeeLatest.set(key, { company: a.company, dateIso: a.awardDateIso })
    }
  }
  const pastAwardees: PackagePastAwardee[] = [...awardeeLatest.entries()].map(([cage, v]) => ({
    cage,
    company: v.company,
    lastAwardDateIso: v.dateIso,
    inBook: bookContact(cage, byCage),
  }))

  const allRows: Array<{ cage: string | null; inBook: PackageBookContact | null }> = [
    ...holders,
    ...approvedSources,
    ...pastAwardees,
  ]
  /*
   * Count DISTINCT CAGEs, never rows. A contactable CAGE can appear on several rows (an
   * approved source with two part numbers, a holder who is also a past awardee), and a row
   * count told the served memo to "reach the two suppliers with a contact channel" when only
   * one reachable company existed. Same dedup the no-channel gap list below already uses.
   */
  const contactChannelsOnFile = new Set(
    allRows
      .filter((r) => r.inBook && (r.inBook.email || r.inBook.phone))
      .map((r) => (r.cage ?? r.inBook!.cage).toUpperCase()),
  ).size

  // ---- gaps: the dossier's own, the eligibility findings, plus what this package could not
  //      establish. The eligibility sentences go in FIRST because they are the only ones that can
  //      say the operator should not be doing this at all, and the memo prompt requires the
  //      package's gaps to be named in the memo, which is how an engine fact reaches the prose.
  const gaps: string[] = [
    ...(eligibility.kind === 'dossier_eligibility' ? eligibility.gaps : [`Bid eligibility: ${eligibility.sentence}`]),
    ...dossier.openGaps,
  ]
  if (holders.length > 0) {
    gaps.push('Availability is listed by the holder and self-reported; nothing here has seen a shelf.')
  } else {
    gaps.push('No company lists stock for this stock number in the export; who holds the article is unconfirmed.')
  }
  const noChannel = [...new Set(allRows.filter((r) => r.cage && !(r.inBook && (r.inBook.email || r.inBook.phone))).map((r) => (r.cage as string).toUpperCase()))]
  for (const cage of noChannel.slice(0, 3)) {
    gaps.push(`No contact channel on file for CAGE ${cage}.`)
  }
  if (noChannel.length > 3) {
    gaps.push(`${noChannel.length - 3} further CAGE(s) also carry no contact channel on file.`)
  }
  if (savedPacketCount === 0) {
    gaps.push('No quote packet is saved for this stock number in Documents; traceability is not documented yet.')
  }

  // ---- next steps: honest and deterministic. DIBBS is the operator's, always. ----
  const solicitation = blank(row.solicitation)
  const returnDate = blank(row.returnDate)
  const nextSteps: string[] = [
    contactChannelsOnFile > 0
      ? `Reach the suppliers named in this package (${contactChannelsOnFile} with a contact channel on file). The buy-side outreach draft is grounded in these same facts.`
      : 'No supplier contact is on file for the CAGEs in this package. Research the approved source directly, or work the Suppliers book.',
    /*
     * THE ELIGIBILITY STANCE IS IN THE PLAN ON EVERY PACKAGE, INCLUDING A CLEAN ONE.
     *
     * A plan that mentions the acquisition posture only when it is adverse teaches an operator
     * that silence means clear, and the day the lookup fails silence means nothing at all. The
     * row is never suppressed for it either: an item the operator may not manufacture is still an
     * item they may be able to supply, which is the whole business.
     *
     * It sits second rather than first only because `test/intelligence/pursuit-package.test.ts`
     * pins step one to the supplier sentence, and that file belongs to another lane in this wave.
     * First is where it belongs.
     */
    eligibility.kind === 'dossier_eligibility' ? eligibility.pursuit.sentence : eligibility.sentence,
    'Confirm the article, its condition and its traceability in writing before quoting. Documents builds the packet.',
    solicitation
      ? `File the quote on DIBBS yourself against solicitation ${solicitation}${returnDate ? ` (quote return date ${returnDate})` : ''}. This product prepares the case; it never submits to a government system.`
      : 'When a live requirement opens, file the quote on DIBBS yourself. This product prepares the case; it never submits to a government system.',
    'When the award lands, record the close in the pipeline with the actual amount and the award reference.',
  ]

  return {
    kind: 'pursuit_package',
    nsn: dossier.nsn,
    item: dossier.item,
    dossier,
    requirement: {
      solicitation,
      quoteReturnDate: returnDate,
      quantity: row.quantity,
      unitOfIssue: row.unitOfIssue,
    },
    economics: {
      modeledBuyValueUsd: modeled,
      quantity,
      lastAwardUnitPriceUsd: lastUnit,
      lastAwardDateIso: lastDate,
      basis,
    },
    eligibility,
    suppliers: { holders, approvedSources, pastAwardees, contactChannelsOnFile },
    documents: { savedPacketCount },
    gaps,
    nextSteps,
  }
}

/**
 * The package as a plain-text markdown document: the served memo first, then the
 * deterministic facts appendix. Used by the Download control and the email body, so what
 * the operator saves is what they read, plus the provenance of every figure. Pure and
 * client-safe: it renders only what it is handed.
 */
export function packageMarkdown(pkg: PursuitPackage, memo: string, servedModel: string): string {
  const lines: string[] = []
  lines.push(`# Pursuit package · ${pkg.nsn}`)
  lines.push('')
  lines.push(pkg.item)
  lines.push('')
  lines.push('## Deal memo')
  lines.push('')
  lines.push(memo)
  lines.push('')
  lines.push(`Written by ${servedModel} from the measured package below. No number appears that this build did not measure.`)
  lines.push('')
  /*
   * ELIGIBILITY GETS ITS OWN SECTION, DIRECTLY UNDER THE MEMO, AND IT IS DETERMINISTIC.
   *
   * The memo above is written by a model. This block is not, so the saved and emailed artifact
   * carries the acquisition posture whether or not the model chose to mention it. That is the
   * difference between a fact being available to the prose and a fact being in the document.
   */
  lines.push('## Bid eligibility')
  lines.push('')
  const el = pkg.eligibility
  if (el.kind === 'eligibility_not_resolved') {
    lines.push(el.sentence)
  } else {
    lines.push(el.headline)
    lines.push('')
    if (el.amc) {
      lines.push(`- AMC ${el.amc.value.code}, VERIFIED verbatim (${el.amc.citation.authority}): ${el.amc.value.meaning}`)
    }
    if (el.amsc) {
      lines.push(`- AMSC ${el.amsc.value.code}, VERIFIED verbatim (${el.amsc.citation.authority}): ${el.amsc.value.meaning}`)
    }
    if (el.posture) {
      lines.push(
        `- Competitive posture, ESTIMATED by us and NOT a government statement: ${el.posture.value.label}.`,
      )
    }
    if (el.combination === 'invalid') {
      lines.push('- The AMC and AMSC pairing on this row is one the validation grid does not permit.')
    }
    if (el.dealerNote) {
      lines.push(`- ${el.dealerNote.citation.authority}, ${el.dealerNote.citation.identifier ?? 'note'}: "${el.dealerNote.value}"`)
    }
    lines.push(`- ${el.surplusSupplyNote.sentence}`)
    if (el.lane) lines.push(`- Award lane: ${el.lane.surplusOffer.sentence}`)
    for (const c of el.cautions) lines.push(`- Caution, evidence ${c.evidence}: ${c.sentence}`)
    lines.push(`- Stance: ${el.pursuit.sentence}`)
  }
  lines.push('')
  lines.push('## The measured package')
  lines.push('')
  lines.push(`- Modeled economics: ${pkg.economics.basis}`)
  if (pkg.requirement.solicitation) {
    lines.push(
      `- Live requirement: solicitation ${pkg.requirement.solicitation}` +
        (pkg.requirement.quoteReturnDate ? `, quote return date ${pkg.requirement.quoteReturnDate}` : '') +
        (pkg.requirement.quantity != null ? `, quantity ${pkg.requirement.quantity.toLocaleString('en-US')} ${pkg.requirement.unitOfIssue}` : ''),
    )
  }
  lines.push(
    `- Score: CornerScore ${pkg.dossier.score.scoreV0} (${pkg.dossier.score.grade}), an ordinal watchlist rank, not a probability or a dollar.`,
  )
  const p = pkg.dossier.pricing
  if (p.awardCount > 0) {
    lines.push(
      `- Award history: ${p.awardCount} recorded award(s)` +
        (p.firstUnitPrice != null && p.lastUnitPrice != null
          ? `, unit price $${usd(p.firstUnitPrice)} first to $${usd(p.lastUnitPrice)} latest` +
            (p.escalationPct != null ? ` (${p.escalationPct > 0 ? '+' : ''}${p.escalationPct}%)` : '')
          : ''),
    )
  } else {
    lines.push('- Award history: none ingested for this stock number. Nothing is estimated in its place.')
  }
  lines.push('')
  lines.push('### Who holds or made the article')
  const sup = pkg.suppliers
  if (sup.holders.length === 0 && sup.approvedSources.length === 0 && sup.pastAwardees.length === 0) {
    lines.push('No holder, approved source, or past awardee is on record in the files on disk.')
  }
  const contactLine = (c: PackageBookContact | null): string =>
    c
      ? ` | in the Suppliers book${c.prospectTier ? ` (tier ${c.prospectTier})` : ''}${c.person ? `, contact ${c.person}` : ''}${c.email ? `, ${c.email}` : ''}${c.phone ? `, ${c.phone}` : ''}`
      : ' | no contact on file'
  for (const h of sup.holders) {
    lines.push(
      `- Lists stock: ${h.company ?? '(unnamed)'}${h.cage ? ` (CAGE ${h.cage})` : ''}${h.quantityListed != null ? `, ${h.quantityListed.toLocaleString('en-US')} listed` : ''} (self-reported, not confirmed)${contactLine(h.inBook)}`,
    )
  }
  for (const s of sup.approvedSources) {
    lines.push(
      `- Approved source: ${s.company ?? '(unnamed)'}${s.cage ? ` (CAGE ${s.cage})` : ''}${s.partNumber ? `, part ${s.partNumber}` : ''}${contactLine(s.inBook)}`,
    )
  }
  for (const a of sup.pastAwardees) {
    lines.push(
      `- Past awardee: ${a.company ?? '(unnamed)'} (CAGE ${a.cage})${a.lastAwardDateIso ? `, last award ${a.lastAwardDateIso}` : ''}${contactLine(a.inBook)}`,
    )
  }
  lines.push('')
  lines.push('### Named gaps')
  for (const g of pkg.gaps) lines.push(`- ${g}`)
  lines.push('')
  lines.push('### Next steps')
  pkg.nextSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
  lines.push('')
  lines.push(
    `Prepared by ONLYSOURCE from the government files on disk. Saved packets for this stock number in Documents: ${pkg.documents.savedPacketCount}.`,
  )
  return lines.join('\n')
}
