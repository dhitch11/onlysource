/**
 * A ROLE NAMED "READ-ONLY" MUST NOT BE ABLE TO CHANGE ANYTHING.
 *
 * =========================================================================================
 * WHAT SHIPPED, AND HOW IT WAS PROVEN RATHER THAN ARGUED
 * =========================================================================================
 * `read_only` was derived as `OPERATOR_PERMISSIONS.filter(k => !sensitive)`. `sensitive` is a
 * READ concept: it marks what is costly to SEE. Used alone it correctly withheld every
 * sensitive read and then silently granted every non-sensitive WRITE. The role held:
 *
 *     board.quote       "Prepare and submit quotes against requirements."
 *     supplier.pursue   "Contact and chase suppliers for material."   (gates 5 write routes)
 *     data.import       "Upload spreadsheets and commit rows."
 *
 * Measured end to end on 2026-08-24, not inferred from the model: a real account on this role
 * signed in through the actual form and posted `/api/suppliers/contacted`, receiving HTTP 200
 * and `{"contacted":["1ABC5"]}`. The supplier was marked contacted by a read-only seat.
 *
 * ★ THE CONTROL IS WHAT MADE IT A FINDING. The same session was refused 403 on
 * `/api/admin/users`. So the enforcement layer was working exactly as written, and the defect
 * was the permission SET, not the check. Without that control the observation would have been
 * "authz is broken", which is a different bug with a different fix.
 *
 * After adding the `mutating` axis the same probe returns 403 with a named reason, while a GET
 * on the same route still returns 200 and `/board` still renders. The role lost writes and
 * kept its reads.
 *
 * ⛔ WHY THIS IS A TEST AND NOT A COMMENT. This product sells the read-only seat to "an
 * auditor, a lender, or somebody new". The same shape has already cost it once:
 * `lib/intelligence/brief/package.ts:157` records two people's names, emails and phone numbers
 * reaching a read_only session on live production. That leak was closed at its own surface and
 * the derivation that produced it was left standing. This asserts the derivation.
 */

import { describe, expect, it } from 'vitest'

import { PERMISSIONS, ROLES, permission, role } from '@/lib/admin/permissions'

describe('the read-only role holds no permission that changes anything', () => {
  /*
   * THE INSTRUMENT IS CHECKED FIRST. Every assertion below is of the form "no permission in
   * this set is mutating". Against an empty set, or a catalog where nothing is marked
   * mutating, they all pass while measuring nothing. So the catalog's own yield is asserted
   * before its verdict is trusted.
   */
  it('has a catalog that actually marks some permissions as mutating', () => {
    const mutating = PERMISSIONS.filter((p) => p.mutating)
    expect(mutating.length).toBeGreaterThan(0)
    // The three that made the live write possible must all still be marked.
    for (const key of ['board.quote', 'supplier.pursue', 'data.import']) {
      expect(permission(key)?.mutating, `${key} must be marked mutating`).toBe(true)
    }
  })

  it('gives read_only a non-empty set, so "holds no writes" is not "holds nothing"', () => {
    const ro = role('read_only')
    expect(ro).toBeDefined()
    expect(ro!.permissions.length).toBeGreaterThan(0)
    expect(ro!.permissions).toContain('board.view')
  })

  it('gives read_only NOTHING that mutates', () => {
    const ro = role('read_only')!
    const offenders = ro.permissions.filter((k) => permission(k)?.mutating)
    expect(offenders, `read_only must hold no mutating permission, found: ${offenders.join(', ')}`).toEqual([])
  })

  it('gives read_only nothing sensitive either, which was already true and must stay true', () => {
    const ro = role('read_only')!
    const offenders = ro.permissions.filter((k) => permission(k)?.sensitive)
    expect(offenders).toEqual([])
  })

  /*
   * The three named keys are asserted individually as well as by the rule above. The rule
   * catches a future permission that is mutating; these catch somebody re-adding one of the
   * exact three that were live, which is the regression with a track record.
   */
  it('specifically withholds the three that were live', () => {
    const ro = role('read_only')!
    expect(ro.permissions).not.toContain('board.quote')
    expect(ro.permissions).not.toContain('supplier.pursue')
    expect(ro.permissions).not.toContain('data.import')
  })

  /*
   * ⚠️ NOT A READ-ONLY RULE, A CATALOG RULE. Every permission must state both axes explicitly.
   * A new row added without `mutating` would be `undefined`, which is falsy, and would land in
   * the read-only role by default. Defaulting to "safe to give away" is the wrong direction,
   * and the type makes it required so this asserts the data agrees with the type.
   */
  it('states both axes on every permission, so a new row cannot default into read_only', () => {
    for (const p of PERMISSIONS) {
      expect(typeof p.mutating, `${p.key} must state mutating`).toBe('boolean')
      expect(typeof p.sensitive, `${p.key} must state sensitive`).toBe('boolean')
    }
  })

  /*
   * The other roles are asserted UNCHANGED. A fix to the smallest role that quietly narrowed
   * the ones people actually work in would be a worse outcome than the defect.
   */
  it('leaves operator, admin and owner able to do their jobs', () => {
    for (const key of ['operator', 'admin', 'owner']) {
      const r = role(key)
      expect(r, `${key} must exist`).toBeDefined()
      expect(r!.permissions, `${key} must keep board.quote`).toContain('board.quote')
      expect(r!.permissions, `${key} must keep supplier.pursue`).toContain('supplier.pursue')
    }
    expect(ROLES.length).toBeGreaterThanOrEqual(4)
  })
})
