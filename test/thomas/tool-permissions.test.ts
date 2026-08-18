import { describe, expect, it } from 'vitest'
import { PERMISSIONS, ROLES, role } from '@/lib/admin/permissions'
import {
  MACHINE_BRIDGE_ACCESS,
  NO_ACCESS,
  TOOL_PERMISSIONS,
  missingFor,
  refuseTool,
  spokenClass,
  toolPermissions,
  withheldClasses,
  type ToolAccess,
} from '@/lib/thomas/authz'
import { SERVER_TOOLS, CLIENT_TOOLS } from '@/lib/thomas/tools'

/**
 * THE MAP FROM A TOOL TO THE PERMISSION ITS DATA NEEDS.
 *
 * ==========================================================================================
 * WHAT THIS FILE IS FOR. Not "does refuseTool return something", which any stub would pass.
 * ==========================================================================================
 * The interesting failures in an authorization map are all quiet ones:
 *
 *   - a tool gets ADDED and nobody maps it, so it runs for everybody. Caught by asserting the
 *     map covers `SERVER_TOOLS` and that an unmapped name refuses.
 *   - a permission key in the map gets RENAMED in the catalog, so `can()` compares against a key
 *     no role can ever hold and the tool refuses for everybody, silently, forever. Caught by
 *     asserting every key in the map still exists in the catalog.
 *   - the refusal turns into a shrug. "I do not have that" is indistinguishable from missing
 *     data, and it is the outcome this whole lane exists to prevent, so the WORDS are asserted.
 *
 * The role names are read from the shipped catalog rather than restated, so a change to what
 * `read_only` holds fails here rather than passing against a copy of the old answer.
 */

/** A caller holding exactly what a named built-in role holds. Read from the catalog, never listed. */
function asRole(key: string): ToolAccess {
  const r = role(key)
  if (!r) throw new Error(`No role "${key}" in the catalog, so this test is asserting nothing.`)
  return { held: r.permissions, kind: 'account', roleName: r.name }
}

const READ_ONLY = asRole('read_only')
const OPERATOR = asRole('operator')
const OWNER = asRole('owner')

describe('the map covers every server tool, and nothing runs unmapped', () => {
  it('names every tool in SERVER_TOOLS', () => {
    for (const t of SERVER_TOOLS) {
      expect(toolPermissions(t.name), `${t.name} is not in TOOL_PERMISSIONS`).not.toBeNull()
    }
  })

  it('names no tool that does not exist', () => {
    const real = new Set(SERVER_TOOLS.map((t) => t.name))
    for (const name of Object.keys(TOOL_PERMISSIONS)) {
      expect(real.has(name), `TOOL_PERMISSIONS names "${name}", which is not a server tool`).toBe(true)
    }
  })

  it('refuses a tool it does not know, even for an owner', () => {
    const refusal = refuseTool('read_every_margin_ever', OWNER)
    expect(refusal).not.toBeNull()
    expect(refusal!.missing).toEqual([])
    // It must not blame the operator's role for a gap on our side.
    expect(refusal!.text).toMatch(/no permission mapping/i)
    expect(refusal!.text).toMatch(/gap on our side/i)
    expect(refusal!.text).not.toMatch(/your role/i)
  })

  it('requires only keys that exist in the permission catalog', () => {
    const known = new Set(PERMISSIONS.map((p) => p.key))
    for (const [tool, keys] of Object.entries(TOOL_PERMISSIONS)) {
      for (const k of keys) {
        expect(known.has(k), `${tool} requires "${k}", which is not a permission`).toBe(true)
      }
    }
  })

  it('has a spoken phrase for every permission in the catalog, so no refusal reads out a key', () => {
    for (const p of PERMISSIONS) {
      // Falling through to the raw key would put "supplier.identity.view" in a spoken sentence.
      expect(spokenClass(p.key), `${p.key} has no phrase and no label`).not.toBe(p.key)
    }
  })

  it('leaves the client tools out of the map on purpose, because they read nothing', () => {
    for (const t of CLIENT_TOOLS) {
      expect(toolPermissions(t.name)).toBeNull()
    }
  })
})

describe('a read-only account, which is the role this lane exists for', () => {
  it('is refused every tool that reads a supplier identity or a price', () => {
    for (const name of ['lookup_stock_number', 'find_opportunities', 'goldmine_snapshot', 'supplier_snapshot']) {
      expect(refuseTool(name, READ_ONLY), `${name} ran for read_only`).not.toBeNull()
    }
  })

  it('is still allowed the board, because withholding everything is its own dishonesty', () => {
    expect(refuseTool('portfolio_snapshot', READ_ONLY)).toBeNull()
  })

  it('gets a sentence that names the boundary, and never suggests the data is missing', () => {
    const refusal = refuseTool('supplier_snapshot', READ_ONLY)!
    expect(refusal.classes).toEqual(['supplier identities'])
    expect(refusal.text).toContain('Read-only')
    expect(refusal.text).toContain('supplier identities')
    expect(refusal.text).toMatch(/not by missing data/i)
    expect(refusal.text).toMatch(/owner can grant it/i)
    // The two failure modes this lane names explicitly: answering anyway, and going quiet.
    expect(refusal.text).toMatch(/Do NOT answer any part of it from memory/i)
    expect(refusal.text).toMatch(/silent omission/i)
  })

  it('is told both classes when a tool needs two, in one readable phrase', () => {
    const refusal = refuseTool('lookup_stock_number', READ_ONLY)!
    expect(refusal.missing).toEqual(['supplier.identity.view', 'margin.view'])
    expect(refusal.text).toContain('supplier identities and cost and pricing')
  })

  it('is told up front which classes it will not get, before it reaches for a tool', () => {
    expect(withheldClasses(READ_ONLY)).toEqual(['supplier identities', 'cost and pricing'])
  })

  /*
   * MEASURED, NOT ASSUMED. The first version of `withheldClasses` returned every sensitive key the
   * caller lacked, which for read_only meant Thomas opened by announcing that their role does not
   * include "Manage connections, Read the audit log and Use break-glass view". No tool can read any
   * of those for anybody, so naming them implies a capability that does not exist and buries the
   * two lines that are real.
   */
  it('does not announce a class no tool could ever surface, whatever the role', () => {
    const required = new Set(Object.values(TOOL_PERMISSIONS).flat())
    const unreachable = PERMISSIONS.filter((p) => p.sensitive && !required.has(p.key))
    expect(unreachable.length, 'this test asserts nothing if every sensitive key is reachable').toBeGreaterThan(0)
    for (const p of unreachable) {
      expect(withheldClasses(READ_ONLY)).not.toContain(spokenClass(p.key))
    }
  })
})

/*
 * WITHOUT THIS BLOCK EVERY REFUSAL ABOVE PROVES NOTHING. A `refuseTool` hardwired to return a
 * refusal would pass all of it. These are the same calls by a caller who holds the keys.
 */
describe('the same calls, by a caller who actually holds the permission', () => {
  it('lets an operator run all five server tools', () => {
    for (const t of SERVER_TOOLS) {
      expect(refuseTool(t.name, OPERATOR), `${t.name} was refused for an operator`).toBeNull()
      expect(missingFor(t.name, OPERATOR)).toEqual([])
    }
  })

  it('lets an owner run all five, and withholds nothing from them', () => {
    for (const t of SERVER_TOOLS) expect(refuseTool(t.name, OWNER)).toBeNull()
    expect(withheldClasses(OWNER)).toEqual([])
  })
})

describe('fail closed: a caller who cannot be resolved holds nothing', () => {
  it('refuses every server tool for NO_ACCESS', () => {
    for (const t of SERVER_TOOLS) expect(refuseTool(t.name, NO_ACCESS)).not.toBeNull()
  })

  it('tells them to sign in, and does NOT send them to an owner for a permission', () => {
    const refusal = refuseTool('portfolio_snapshot', NO_ACCESS)!
    expect(refusal.text).toMatch(/does not resolve to an account/i)
    expect(refusal.text).toMatch(/signing in again/i)
    expect(refusal.text).toMatch(/Do NOT tell them to ask an owner/i)
  })
})

describe('the machine bridge, which carries no identity at all', () => {
  it('holds no sensitive permission, whichever ones the catalog carries', () => {
    for (const p of PERMISSIONS.filter((x) => x.sensitive)) {
      expect(
        MACHINE_BRIDGE_ACCESS.held.includes(p.key),
        `the spoken bridge holds the sensitive permission "${p.key}"`,
      ).toBe(false)
    }
  })

  it('holds no admin-plane permission either', () => {
    for (const p of PERMISSIONS.filter((x) => x.plane === 'admin')) {
      expect(MACHINE_BRIDGE_ACCESS.held.includes(p.key)).toBe(false)
    }
  })

  it('is DERIVED from the catalog rather than listed, so a new sensitive key is excluded on its own', () => {
    const derived = PERMISSIONS.filter((p) => p.plane === 'operator' && !p.sensitive).map((p) => p.key)
    expect([...MACHINE_BRIDGE_ACCESS.held]).toEqual(derived)
  })

  it('refuses every sensitive class outright, and says the line holds no account', () => {
    for (const name of ['lookup_stock_number', 'find_opportunities', 'goldmine_snapshot', 'supplier_snapshot']) {
      const refusal = refuseTool(name, MACHINE_BRIDGE_ACCESS)
      expect(refusal, `${name} ran on the spoken bridge`).not.toBeNull()
      expect(refusal!.text).toMatch(/holds no account/i)
    }
  })

  it('can still read the board out loud, so the voice line is not a dead end', () => {
    expect(refuseTool('portfolio_snapshot', MACHINE_BRIDGE_ACCESS)).toBeNull()
  })
})

describe('the roles this map is enforced against are the ones the product ships', () => {
  it('read_only really does hold no sensitive permission, which is what makes it the test case', () => {
    const readOnly = ROLES.find((r) => r.key === 'read_only')!
    const sensitive = new Set(PERMISSIONS.filter((p) => p.sensitive).map((p) => p.key))
    expect(readOnly.permissions.filter((k) => sensitive.has(k))).toEqual([])
  })
})
