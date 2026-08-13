/**
 * IDENTITY, EXERCISED AGAINST A REAL DATABASE.
 *
 * This does not assert that the Better Auth config "looks right". It creates a user, signs
 * them in, reads the rows back out of Postgres, and tries to sign in with the wrong
 * password. A config test would have passed with `generateId: false` set against columns
 * that have no default, and every insert would have failed in production.
 *
 * It also proves the ONLYSOURCE seed produces exactly the two named people, in the right
 * roles, and that the org invariants the DDL claims are actually enforced.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { seedOnlysource } from '../../db/seed'
import { startTestDatabase, type TestDatabase } from '../support/database'

let db: TestDatabase
let auth: Awaited<ReturnType<typeof loadAuth>>

async function loadAuth() {
  const mod = await import('../../lib/auth/server')
  return mod.getAuth()
}

beforeAll(async () => {
  db = await startTestDatabase(55441)
  // Better Auth reads this at first use. The auth module is lazy precisely so this works.
  process.env.DATABASE_URL_RUNTIME = db.superUrl
  auth = await loadAuth()
}, 120_000)

afterAll(async () => {
  const mod = await import('../../lib/auth/server')
  await mod.resetAuthForTest()
  await db?.stop()
})

async function query(sql: string, values: unknown[] = []) {
  const c = new Client({ connectionString: db.superUrl })
  await c.connect()
  try {
    return await c.query(sql, values as never[])
  } finally {
    await c.end()
  }
}

describe('Better Auth against our own Postgres, with our snake_case columns', () => {
  it('creates a real user row, with the mapped column names', async () => {
    const result = await auth.api.signUpEmail({
      body: {
        email: 'harness@onlysource.ai',
        password: 'a-long-enough-password',
        name: 'Harness User',
      },
    })
    expect(result.user.email).toBe('harness@onlysource.ai')

    // Read it back out of the DATABASE, not out of the library's return value. The library
    // could return a plausible object while the insert silently went somewhere else.
    const rows = await query('select id, email, email_verified, created_at from app_user where email = $1', [
      'harness@onlysource.ai',
    ])
    expect(rows.rowCount).toBe(1)
    expect(rows.rows[0]!.email_verified).toBe(false)
    expect(rows.rows[0]!.id).toBeTruthy()
  })

  it('stores a password HASH in account, never the password', async () => {
    const rows = await query(
      `select a.password from account a join app_user u on u.id = a.user_id where u.email = $1`,
      ['harness@onlysource.ai'],
    )
    expect(rows.rowCount).toBe(1)
    const stored = rows.rows[0]!.password as string
    expect(stored).toBeTruthy()
    // The literal password must not appear anywhere in the stored value.
    expect(stored).not.toContain('a-long-enough-password')
    expect(stored.length).toBeGreaterThan(40)
  })

  it('signs in with the right password and writes a SERVER-SIDE session row', async () => {
    const result = await auth.api.signInEmail({
      body: { email: 'harness@onlysource.ai', password: 'a-long-enough-password' },
    })
    expect(result.user.email).toBe('harness@onlysource.ai')

    // A stateless JWT would leave nothing here. Instant revocation needs a row.
    const rows = await query(
      `select s.id, s.expires_at from session s join app_user u on u.id = s.user_id where u.email = $1`,
      ['harness@onlysource.ai'],
    )
    expect(rows.rowCount).toBeGreaterThanOrEqual(1)
    expect(new Date(rows.rows[0]!.expires_at as string).getTime()).toBeGreaterThan(0)
  })

  it('REFUSES the wrong password. The negative path is the one that matters', async () => {
    await expect(
      auth.api.signInEmail({
        body: { email: 'harness@onlysource.ai', password: 'not-the-right-password' },
      }),
    ).rejects.toThrow()
  })

  it('REFUSES a password under the 12 character NIST floor', async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: 'short@onlysource.ai', password: 'short', name: 'Short' },
      }),
    ).rejects.toThrow()
    const rows = await query('select 1 from app_user where email = $1', ['short@onlysource.ai'])
    expect(rows.rowCount).toBe(0)
  })

  it('REFUSES a duplicate email, because the unique index is real', async () => {
    await expect(
      auth.api.signUpEmail({
        body: {
          email: 'harness@onlysource.ai',
          password: 'another-long-password',
          name: 'Impostor',
        },
      }),
    ).rejects.toThrow()
  })

  it('is case-insensitive on email, so two people cannot claim one address', async () => {
    // The unique index is on lower(email). Without it, HARNESS@ and harness@ are two users.
    await expect(
      auth.api.signUpEmail({
        body: {
          email: 'HARNESS@onlysource.ai',
          password: 'another-long-password',
          name: 'Case Impostor',
        },
      }),
    ).rejects.toThrow()
  })
})

describe('the ONLYSOURCE seed', () => {
  beforeAll(async () => {
    await seedOnlysource(db.superUrl)
  })

  it('creates exactly one org, named ONLYSOURCE', async () => {
    const rows = await query(`select name, slug from org where slug = 'onlysource'`)
    expect(rows.rowCount).toBe(1)
    expect(rows.rows[0]!.name).toBe('ONLYSOURCE')
  })

  it('creates David Hitchman as Owner and David Goodreau as Admin, both ProjectX', async () => {
    const rows = await query(
      `select u.name, u.email, u.title, m.role, m.status
         from membership m
         join app_user u on u.id = m.user_id
         join org o on o.id = m.org_id
        where o.slug = 'onlysource'
     order by m.role`,
    )
    expect(rows.rowCount).toBe(2)
    const byRole = Object.fromEntries(rows.rows.map((r) => [r.role, r]))

    expect(byRole.owner!.name).toBe('David Hitchman')
    expect(byRole.owner!.email).toBe('dhitchman@onlysource.ai')
    expect(byRole.owner!.title).toBe('ProjectX')
    expect(byRole.owner!.status).toBe('active')

    expect(byRole.admin!.name).toBe('David Goodreau')
    expect(byRole.admin!.email).toBe('dgoodreau@onlysource.ai')
    expect(byRole.admin!.title).toBe('ProjectX')
    expect(byRole.admin!.status).toBe('active')
  })

  it('is idempotent, so a redeploy does not create a second org or duplicate members', async () => {
    await seedOnlysource(db.superUrl)
    await seedOnlysource(db.superUrl)
    const orgs = await query(`select count(*)::int as n from org where slug = 'onlysource'`)
    expect(orgs.rows[0]!.n).toBe(1)
    const members = await query(
      `select count(*)::int as n from membership m join org o on o.id = m.org_id where o.slug = 'onlysource'`,
    )
    expect(members.rows[0]!.n).toBe(2)
  })

  it('enforces ONE owner per org at the database, not in application code', async () => {
    const org = await query(`select id from org where slug = 'onlysource'`)
    const user = await query(`select id from app_user where email = 'harness@onlysource.ai'`)
    await expect(
      query(`insert into membership (org_id, user_id, role) values ($1, $2, 'owner')`, [
        org.rows[0]!.id,
        user.rows[0]!.id,
      ]),
    ).rejects.toThrow(/membership_single_owner_key|duplicate key/i)
  })

  it('refuses a role that is not one of the six', async () => {
    const org = await query(`select id from org where slug = 'onlysource'`)
    const user = await query(`select id from app_user where email = 'harness@onlysource.ai'`)
    await expect(
      query(`insert into membership (org_id, user_id, role) values ($1, $2, 'superuser')`, [
        org.rows[0]!.id,
        user.rows[0]!.id,
      ]),
    ).rejects.toThrow(/violates check constraint/i)
  })

  it('seeds NO fake data beyond the two real people and their org', async () => {
    // House law 1. A seed is the easiest place in a codebase to smuggle in a convincing
    // demo, so this asserts the absence of one.
    for (const table of ['holding', 'invitation', 'capability_gate', 'audit_event']) {
      const rows = await query(`select count(*)::int as n from ${table}`)
      expect(`${table}=${rows.rows[0]!.n}`).toBe(`${table}=0`)
    }
  })
})
