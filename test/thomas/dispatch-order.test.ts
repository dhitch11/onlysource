import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { role } from '@/lib/admin/permissions'
import { runServerTool } from '@/lib/thomas/tools'
import type { ToolAccess } from '@/lib/thomas/authz'

/**
 * REFUSED, ABSENT AND ANSWERED ARE THREE DIFFERENT FACTS, AND THE ORDER THEY ARE CHECKED IN MATTERS.
 *
 * ==========================================================================================
 * WHY THE PERMISSION CHECK RUNS BEFORE THE DATA ROOT IS EVEN RESOLVED.
 * ==========================================================================================
 * `runServerTool` can end in three places, and an operator has to be able to tell them apart:
 *
 *   REFUSED   your role does not include this. The platform holds it. Ask an owner.
 *   ABSENT    the feed is not mounted in this environment. Nobody can read it right now.
 *   ANSWERED  here is the measurement.
 *
 * If the data root were resolved first, a read_only account on a box with no feed would be told the
 * feed is unmounted, which is a true sentence about the wrong thing: their role is why they cannot
 * have it, and it would still be why on a box with a perfect feed. They would go and chase an
 * infrastructure problem that does not exist. That is the same family as reporting a permission
 * boundary as a data gap, and it is why the order is asserted here rather than left to reading.
 *
 * THE DATA ROOT IS POINTED SOMEWHERE THAT DOES NOT EXIST ON PURPOSE. It makes the ABSENT branch
 * reachable in a unit test, and it means a permitted tool proves it got PAST the permission check
 * without parsing fifteen megabytes of workbook to do it.
 */

function asRole(key: string): ToolAccess {
  const r = role(key)
  if (!r) throw new Error(`No role "${key}" in the catalog, so this test is asserting nothing.`)
  return { held: r.permissions, kind: 'account', roleName: r.name }
}

const READ_ONLY = asRole('read_only')
const OPERATOR = asRole('operator')

const previousDataDir = process.env.ONLYSOURCE_DATA_DIR

beforeEach(() => {
  process.env.ONLYSOURCE_DATA_DIR = '/nonexistent/onlysource-data-for-this-test'
})

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.ONLYSOURCE_DATA_DIR
  else process.env.ONLYSOURCE_DATA_DIR = previousDataDir
})

describe('the permission check runs first, before anything is read or said about the feed', () => {
  it('tells a read_only caller about their role, not about the missing feed', async () => {
    const outcome = await runServerTool('supplier_snapshot', {}, READ_ONLY)

    expect(outcome.refused).toBeTruthy()
    expect(outcome.refused!.classes).toEqual(['supplier identities'])
    expect(outcome.text).toMatch(/REFUSED BY PERMISSION/)
    // The wrong answer, and the one that would send them to fix the wrong thing.
    expect(outcome.text).not.toMatch(/FEED IS NOT MOUNTED/)
  })

  it('returns no numbers from a refused call, so nothing joins the speakable set', async () => {
    const outcome = await runServerTool('lookup_stock_number', { nsn: '5310-00-004-5033' }, READ_ONLY)
    expect(outcome.refused).toBeTruthy()
    expect(outcome.numbers).toEqual([])
  })

  it('does not mark a refusal as an error, because nothing went wrong', async () => {
    const outcome = await runServerTool('goldmine_snapshot', {}, READ_ONLY)
    expect(outcome.refused).toBeTruthy()
    expect(outcome.isError).toBeUndefined()
  })

  it('refuses a tool nobody mapped, even for a caller who holds everything', async () => {
    const outcome = await runServerTool('read_every_margin_ever', {}, OPERATOR)
    expect(outcome.refused).toBeTruthy()
    expect(outcome.refused!.missing).toEqual([])
  })
})

/*
 * THE POSITIVE CONTROL. Without it, a `runServerTool` that refused unconditionally would pass every
 * assertion above. This is the same function, the same absent feed, and a tool the caller may run:
 * it must get PAST the permission gate and land on the honest empty state instead.
 */
describe('a tool the caller may run reaches the feed, and states its absence honestly', () => {
  it('answers ABSENT rather than REFUSED for read_only on the board', async () => {
    const outcome = await runServerTool('portfolio_snapshot', {}, READ_ONLY)

    expect(outcome.refused).toBeUndefined()
    expect(outcome.text).toMatch(/FEED IS NOT MOUNTED/)
    expect(outcome.isError).toBe(true)
    expect(outcome.text).not.toMatch(/REFUSED/)
  })

  it('answers ABSENT for an operator on every tool, so the gate is what changed and nothing else', async () => {
    for (const name of ['lookup_stock_number', 'find_opportunities', 'goldmine_snapshot', 'supplier_snapshot']) {
      const outcome = await runServerTool(name, { nsn: '5310-00-004-5033' }, OPERATOR)
      expect(outcome.refused, `${name} was refused for an operator`).toBeUndefined()
      expect(outcome.text).toMatch(/FEED IS NOT MOUNTED/)
    }
  })
})
