/**
 * WHAT CROSSES THE WIRE TO THE SUPPLIERS GRID: EVERY SUPPLIER, AND NOBODY'S PHONE NUMBER.
 *
 * ---------------------------------------------------------------------------------------
 * THIS REPLACES A BOUND, AND THE REASON IS THAT THE BOUND ANSWERED THE WRONG QUESTION
 * ---------------------------------------------------------------------------------------
 * The previous version capped the book at 1.5MB of suppliers, shipping ~694 of 3,471. That cut
 * the payload 73% and stopped 6,230 people's contact records leaving the server, and both were
 * real. But it bought them by TRUNCATING THE ROSTER, and an operator could not reach a supplier
 * that fell outside the budget. The owner's instruction is that every supplier must be
 * reachable, and he is right: a book of business with 80% of it withheld is not a book.
 *
 * ★ CAPACITY AND PRIVACY WERE NEVER THE TRADE-OFF. THE ROW SHAPE WAS. Measured over the real
 * data, 3,471 suppliers:
 *
 *     FULL rows            5,607,615 B   1,616 B/row
 *        of which PII      2,269,138 B   40%   contacts, executive, direct email and phone
 *        of which prose    1,371,317 B   24%   the researcher's rationale and findings
 *     LEAN rows              918,449 B     265 B/row   16% of full
 *
 * **Every supplier at 918KB is 45% SMALLER than the bounded 694 at 1.68MB.** Full roster, less
 * data on the wire, and no contact details leaving the server at all by default. A cap was the
 * wrong instrument for a payload made of fields nobody was looking at.
 *
 * ---------------------------------------------------------------------------------------
 * ★★ AND THE PII WAS ALSO AN AUTHORIZATION DEFECT, WHICH IS THE HALF THAT IS NOT ABOUT BYTES
 * ---------------------------------------------------------------------------------------
 * `supplier.identity.view` is `sensitive: true` in `lib/admin/permissions.ts`, and the
 * `read_only` role is defined as "every non-sensitive operator permission, and nothing marked
 * sensitive", so it deliberately does NOT hold it. `app/(app)/suppliers/page.tsx` contained no
 * permission check of any kind. **A read-only account received the names, titles, emails,
 * phones and LinkedIn profiles of every contact at 3,471 companies.**
 *
 * The permission existed, was correctly marked sensitive, and the role correctly withheld it.
 * The read path simply never asked. That is the same class already fixed on the AI surface:
 * seeing-permissions are not enforced by gating the calls that MUTATE.
 *
 * So the split below is not a performance decision with a privacy benefit. **The lean row is
 * what any signed-in operator may see, and everything omitted from it is behind
 * `supplier.identity.view`, one company at a time, fetched only when a row is opened.**
 *
 * ---------------------------------------------------------------------------------------
 * WHY EVERY OMITTED FIELD IS OMITTED
 * ---------------------------------------------------------------------------------------
 * Nothing is dropped for size alone. A field is on the lean row if the GRID needs it to render
 * a column, run a filter, count a tab, sort, or export what is on screen. Everything else is
 * detail, and detail is either a person's contact information or the researcher's prose, both
 * of which are only ever read inside the row expansion.
 */
import type { DistressedSupplier } from '@/lib/intelligence/suppliers/distressed'

/**
 * The row every signed-in operator may see. No contact information of any kind, and none of the
 * researcher's long-form prose.
 *
 * `hasContacts` and `contactCount` are deliberately here: the grid has to be able to say a
 * company HAS reachable people without saying who they are, and an operator deciding what to
 * open needs that. A count is not an identity.
 */
export type LeanSupplier = {
  readonly cage: string
  readonly company: string | null
  readonly city: string | null
  readonly state: string | null
  readonly prospectTier: string | null
  readonly prospectScore: number | null
  readonly holdsInventory: string | null
  readonly awardsInWindow: number | null
  readonly lastAwardedAt: string | null
  readonly currentlyInBusiness: string | null
  readonly industry: string | null
  readonly employees: string | null
  readonly samStatus: string | null
  readonly samExpiration: string | null
  readonly cageStatus: string | null
  readonly uei: string | null
  /** How many people are on file, WITHOUT saying who. A count is not an identity. */
  readonly contactCount: number
  /** Whether a phone number exists at all, so the grid can show the call affordance honestly. */
  readonly hasPhone: boolean
}

/** Everything held back until a permitted person opens one specific company. */
export type SupplierDetail = {
  readonly cage: string
  readonly contacts: DistressedSupplier['contacts']
  readonly executive: string | null
  readonly executiveTitle: string | null
  readonly executiveLinkedin: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly url: string | null
  readonly companyLinkedin: string | null
  readonly prospectRationale: string | null
  readonly keyFindings: string | null
  readonly whyNoAwards: string | null
}

export function toLean(s: DistressedSupplier): LeanSupplier {
  return {
    cage: s.cage,
    company: s.company,
    city: s.city,
    state: s.state,
    prospectTier: s.prospectTier,
    prospectScore: s.prospectScore,
    holdsInventory: s.holdsInventory,
    awardsInWindow: s.awardsInWindow,
    lastAwardedAt: s.lastAwardedAt,
    currentlyInBusiness: s.currentlyInBusiness,
    industry: s.industry,
    employees: s.employees,
    samStatus: s.samStatus,
    samExpiration: s.samExpiration,
    cageStatus: s.cageStatus,
    uei: s.uei,
    contactCount: s.contacts.length,
    hasPhone: s.phone !== null || s.contacts.some((c) => c.phone !== null),
  }
}

export function toDetail(s: DistressedSupplier): SupplierDetail {
  return {
    cage: s.cage,
    contacts: s.contacts,
    executive: s.executive,
    executiveTitle: s.executiveTitle,
    executiveLinkedin: s.executiveLinkedin,
    email: s.email,
    phone: s.phone,
    url: s.url,
    companyLinkedin: s.companyLinkedin,
    prospectRationale: s.prospectRationale,
    keyFindings: s.keyFindings,
    whyNoAwards: s.whyNoAwards,
  }
}

/**
 * The whole book, lean, in the order the grid wants it: Tier A first, then the researcher's
 * score. Deterministic and stable, so two renders of one book agree. Nothing is scored here and
 * NOTHING IS DROPPED: this returns every supplier handed in.
 */
export function leanBook(rows: readonly DistressedSupplier[]): LeanSupplier[] {
  const isHot = (r: DistressedSupplier) => /hot|^a/i.test(r.prospectTier ?? '')
  return [...rows]
    .sort((a, b) => {
      const hot = Number(isHot(b)) - Number(isHot(a))
      return hot !== 0 ? hot : (b.prospectScore ?? -1) - (a.prospectScore ?? -1)
    })
    .map(toLean)
}
