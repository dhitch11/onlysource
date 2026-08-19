import { describe, expect, it } from 'vitest'
import { buildOutreachDossier } from '@/lib/intelligence/suppliers/outreach-dossier'
import { buildDistressedSuppliers } from '@/lib/intelligence/suppliers/distressed'
import { buildAllDatasets } from '@/lib/intelligence/datasets'

/*
 * ==========================================================================================
 * THE OUTREACH DOSSIER AND `supplier.identity.view`.
 * ==========================================================================================
 * The SECOND instance of a bypass whose first instance was fixed hours earlier on
 * `/api/pursuit-package`. Found by walking every route rather than waiting for a report.
 *
 * Both outreach routes gate on `supplier.pursue`. That permission is NOT marked sensitive, so
 * the `read_only` role holds it — the role whose stated promise in lib/admin/permissions.ts is
 * that its holder "never sees a document body, a supplier identity, a margin or a secret ...
 * the sales answer to 'can your staff read my supplier negotiations'."
 *
 * It was worse here than in the package. `POST /api/outreach-draft` returns the WHOLE dossier in
 * its JSON response, and `POST /api/outreach-draft/email` printed the recipient into the email
 * body as "Send it yourself to: {person}, {email}".
 *
 * ★ THE GENERAL RULE, third time it has bitten this product: four of the fourteen permissions
 * govern SEEING a fact rather than doing one, and this codebase enforces permissions at the
 * point of ACTION. A permission only ever checked before a write is not enforced on a read path.
 *
 * These assert the SECRET IS ABSENT FROM THE SERIALISED OBJECT rather than that a guard is
 * present. A guard check passes the day somebody adds a second field; a shape check over the
 * whole object does not. This dossier is serialised straight into a model prompt, so anything
 * left on it gets spoken.
 */

/** A stock number that actually has holders with book records, chosen from the live corpus. */
function nsnWithAReachableHolder(): string | null {
  const book = buildDistressedSuppliers()
  if (!book.ok) return null
  const { cornerMap } = buildAllDatasets()
  for (const row of cornerMap.rows.slice(0, 400)) {
    const built = buildOutreachDossier(row.nsn, true)
    if (!built.ok) continue
    if (built.dossier.target.book?.email || built.dossier.target.book?.phone) return row.nsn
  }
  return null
}

describe('the outreach dossier withholds identities from a caller without the permission', () => {
  const nsn = nsnWithAReachableHolder()

  it('found a stock number with a real contactable holder, so these tests are not vacuous', () => {
    // Without this, every assertion below passes on an empty dossier and proves nothing.
    expect(nsn, 'no corner in the corpus has a holder with an email or phone on file').toBeTruthy()
  })

  it('carries no person, email or phone anywhere in the serialised dossier', () => {
    if (!nsn) return
    const shownB = buildOutreachDossier(nsn, true)
    const hiddenB = buildOutreachDossier(nsn, false)
    expect(shownB.ok && hiddenB.ok).toBe(true)
    if (!shownB.ok || !hiddenB.ok) return
    const shown = shownB.dossier
    const hidden = hiddenB.dossier

    expect(hidden.target.book?.person ?? null).toBeNull()
    expect(hidden.target.book?.email ?? null).toBeNull()
    expect(hidden.target.book?.phone ?? null).toBeNull()

    // and nothing reintroduced them anywhere else in the object
    const json = JSON.stringify(hidden)
    for (const secret of [shown.target.book?.person, shown.target.book?.email, shown.target.book?.phone]) {
      if (!secret) continue
      expect(json, `"${secret}" survived redaction`).not.toContain(secret)
    }
  })

  it('POSITIVE CONTROL: the same stock number DOES carry them when the caller holds it', () => {
    if (!nsn) return
    const built = buildOutreachDossier(nsn, true)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const b = built.dossier.target.book
    expect(Boolean(b?.email || b?.phone), 'the control itself must carry a contact').toBe(true)
  })

  /*
   * ★★ THE ONE THAT WOULD HAVE BEEN MISSED, and the reason redaction order is not a detail.
   *
   * The target holder is chosen by "who has an email, else who has a phone, else the first". Do
   * the redaction before that choice and both predicates go false, so the draft silently
   * addresses a DIFFERENT COMPANY. The permission would have changed not only what the caller
   * sees but which supplier the product decided to write to.
   */
  it('addresses the same company either way', () => {
    if (!nsn) return
    const shown = buildOutreachDossier(nsn, true)
    const hidden = buildOutreachDossier(nsn, false)
    if (!shown.ok || !hidden.ok) return
    expect(hidden.dossier.target.cage).toBe(shown.dossier.target.cage)
    expect(hidden.dossier.target.company).toBe(shown.dossier.target.company)
  })

  /*
   * And the count of who is reachable is not an identity. Collapsing it to false would tell an
   * operator that nobody is contactable, which is a false statement about the data rather than a
   * refusal to show a name.
   */
  it('does not turn a withheld identity into a false "nobody is reachable"', () => {
    if (!nsn) return
    const shown = buildOutreachDossier(nsn, true)
    const hidden = buildOutreachDossier(nsn, false)
    if (!shown.ok || !hidden.ok) return
    expect(hidden.dossier.otherHolders.map((h) => h.contactOnFile)).toEqual(
      shown.dossier.otherHolders.map((h) => h.contactOnFile),
    )
  })

  /* Everything that is NOT an identity must still be there: withholding three fields is not a
     licence to serve a thinner dossier and call it the same thing. */
  it('keeps the company, CAGE, quantity and the live requirement intact', () => {
    if (!nsn) return
    const shown = buildOutreachDossier(nsn, true)
    const hidden = buildOutreachDossier(nsn, false)
    if (!shown.ok || !hidden.ok) return
    expect(hidden.dossier.nsn).toBe(shown.dossier.nsn)
    expect(hidden.dossier.item).toBe(shown.dossier.item)
    expect(hidden.dossier.liveRequirement).toEqual(shown.dossier.liveRequirement)
    expect(hidden.dossier.lastAward).toEqual(shown.dossier.lastAward)
    expect(hidden.dossier.target.book?.company ?? null).toBe(shown.dossier.target.book?.company ?? null)
    expect(hidden.dossier.otherHolders.length).toBe(shown.dossier.otherHolders.length)
  })
})
