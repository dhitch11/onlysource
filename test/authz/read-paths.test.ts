/**
 * FOUR OF THE FOURTEEN PERMISSIONS GOVERN SEEING A FACT RATHER THAN DOING ONE.
 *
 * This product enforced permissions at the point of ACTION. Every mutation is properly gated, and
 * the read paths were gated wherever a route happened to exist. A permission checked only before a
 * write is not enforced on a read path, and a SERVER-RENDERED PAGE IS A READ PATH.
 *
 * Three instances of one sentence were found in one night: the AI surface, /suppliers, and
 * /documents. This file asserts the property those fixes depend on, because a page-level check is
 * only meaningful while the role model actually withholds the permission.
 */
import { describe, expect, it } from 'vitest'

import { PERMISSIONS, ROLES, roleOrUnrecognised } from '@/lib/admin/permissions'
import { callerRoleName } from '@/lib/session/authz'

const perm = (key: string) => PERMISSIONS.find((p) => p.key === key)
const role = (key: string) => ROLES.find((r) => r.key === key)

describe('the permissions that govern SEEING are the ones that were unenforced', () => {
  it('all four are marked sensitive, which is what makes read_only exclude them', () => {
    for (const key of ['supplier.identity.view', 'margin.view', 'document.view', 'data.export']) {
      expect(perm(key), `${key} must exist`).toBeDefined()
      expect(perm(key)!.sensitive, `${key} must be sensitive`).toBe(true)
    }
  })

  /*
   * ★ THE ASSERTION THE PAGE GATES DEPEND ON. If read_only ever gained one of these, the checks
   * added to /suppliers and /documents would still pass while protecting nothing, and nobody
   * would notice because the pages would simply start rendering.
   */
  it('read_only holds NONE of them', () => {
    const r = role('read_only')
    expect(r).toBeDefined()
    for (const key of ['supplier.identity.view', 'margin.view', 'document.view', 'data.export']) {
      expect(r!.permissions, `read_only must not hold ${key}`).not.toContain(key)
    }
  })

  it('and it does hold the non-sensitive operator permissions, so it is not simply empty', () => {
    const r = role('read_only')!
    expect(r.permissions).toContain('board.view')
    expect(r.permissions.length).toBeGreaterThan(0)
  })

  it('owner holds all four, or the gates would lock out the person who owns the data', () => {
    const o = role('owner')!
    for (const key of ['supplier.identity.view', 'margin.view', 'document.view', 'data.export']) {
      expect(o.permissions, `owner must hold ${key}`).toContain(key)
    }
  })
})

describe('the role name a refusal shows', () => {
  /*
   * Hoisted out of app/(app)/admin/page.tsx when a second surface needed it. Two copies of this
   * mapping drift silently: one screen says "No account" while another says "Anonymous" about the
   * same session, and neither is wrong enough for anyone to notice.
   */
  it('names an unrecognised role as unrecognised rather than repairing it', () => {
    const unknown = roleOrUnrecognised('read_onlyy')
    expect(unknown.permissions).toHaveLength(0)
    expect(unknown.name.toLowerCase()).toContain('unrecognis')
  })

  it('an anonymous caller is named, not blank', () => {
    expect(callerRoleName({ kind: 'anonymous', reason: 'no_session' })).toBe('No account')
  })

  it('a break-glass session says what it is', () => {
    expect(callerRoleName({ kind: 'bootstrap' })).toBe('Break-glass session')
  })
})
