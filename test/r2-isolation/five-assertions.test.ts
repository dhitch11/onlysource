/**
 * GATE R2.1. THE FIVE DATABASE ISOLATION ASSERTIONS.
 *
 * This is the single most important test in the codebase. A failure here blocks every merge,
 * forever.
 *
 * It runs AT THE DATABASE, as `app_runtime`, through a pool, across two orgs on the SAME
 * physical connection. It does not go through the API, because an API-level "A cannot read
 * B" test proves almost nothing: the application's own WHERE clause may be doing all the
 * work while every policy underneath is decorative.
 *
 * Every assertion below carries a POSITIVE CONTROL. Proving that org B reads zero rows is
 * worthless on its own, because zero rows is also what a broken connection, an empty table
 * or a typo'd table name returns. Each test therefore also proves org A CAN read the row.
 * Without that pairing the whole harness passes on an empty database.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, Pool } from 'pg'
import { seedTwoOrgs, startTestDatabase, type TestDatabase } from '../support/database'

let db: TestDatabase
let orgA: string
let orgB: string

beforeAll(async () => {
  db = await startTestDatabase(55440)
  const seeded = await seedTwoOrgs(db.superUrl)
  orgA = seeded.orgA
  orgB = seeded.orgB
}, 120_000)

afterAll(async () => {
  await db?.stop()
})

/*
 * ROLLBACK ON ERROR IS NOT OPTIONAL HERE, and getting it wrong cost me a confusing red run.
 * Several assertions below EXPECT a query to be refused. Postgres puts the transaction into
 * an aborted state on any error, and this pool is deliberately capped at ONE connection, so
 * returning an aborted connection to the pool poisons every later test with
 * "current transaction is aborted". Ten tests then failed for a reason that had nothing to
 * do with what they were testing, which is exactly how a real defect gets buried in noise.
 */
async function runInTx(
  sql: string,
  values: unknown[],
  orgId: string | null,
  rawOrgValue?: string,
) {
  const client = await db.runtimePool.connect()
  try {
    await client.query('begin')
    if (orgId !== null) {
      await client.query('select set_config($1, $2, true)', ['app.org_id', orgId])
    } else if (rawOrgValue !== undefined) {
      await client.query('select set_config($1, $2, true)', ['app.org_id', rawOrgValue])
    }
    const r = await client.query(sql, values as never[])
    await client.query('commit')
    return r
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Run a query as app_runtime inside a transaction with the org context set. */
async function asOrg(orgId: string, sql: string, values: unknown[] = []) {
  return runInTx(sql, values, orgId)
}

/** Run a query as app_runtime inside a transaction with NO org context set. */
async function withNoOrgContext(sql: string, values: unknown[] = []) {
  return runInTx(sql, values, null)
}

/** Run with app.org_id explicitly set to a given raw string, e.g. the empty string. */
async function withRawOrgContext(raw: string, sql: string, values: unknown[] = []) {
  return runInTx(sql, values, null, raw)
}

// ===========================================================================================
describe('ASSERTION 1: app_runtime owns nothing and cannot bypass row security', () => {
  // If the application connects as the role that owns the tables, every policy is
  // decorative and every functional test still passes. This is the one defect that is
  // invisible to testing, so it is asserted against the catalog rather than trusted.

  it('owns zero tables', async () => {
    const r = await withNoOrgContext(`
      select count(*)::int as n
      from pg_tables
      where schemaname = 'public' and tableowner = 'app_runtime'
    `)
    expect(r.rows[0].n).toBe(0)
  })

  it('positive control: some role DOES own the tables, so the query above can find owners', async () => {
    const r = await withNoOrgContext(`
      select count(*)::int as n
      from pg_tables
      where schemaname = 'public' and tableowner = 'app_migrator'
    `)
    expect(r.rows[0].n).toBeGreaterThan(0)
  })

  it('lacks BYPASSRLS and is not a superuser', async () => {
    const r = await withNoOrgContext(`
      select rolbypassrls, rolsuper, rolcreatedb, rolcreaterole
      from pg_roles where rolname = 'app_runtime'
    `)
    expect(r.rows[0].rolbypassrls).toBe(false)
    expect(r.rows[0].rolsuper).toBe(false)
    expect(r.rows[0].rolcreatedb).toBe(false)
    expect(r.rows[0].rolcreaterole).toBe(false)
  })

  it('every Zone A table has RLS enabled AND forced', async () => {
    const r = await withNoOrgContext(`
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class
      where relname in ('org','holding','membership','invitation','capability_gate','audit_event')
      order by relname
    `)
    expect(r.rows.length).toBe(6)
    for (const row of r.rows) {
      expect(`${row.relname}:enabled=${row.relrowsecurity}`).toBe(`${row.relname}:enabled=true`)
      expect(`${row.relname}:forced=${row.relforcerowsecurity}`).toBe(`${row.relname}:forced=true`)
    }
  })
})

// ===========================================================================================
describe('ASSERTION 2: two orgs back to back on the SAME pooled connection do not cross-read', () => {
  // The pool is capped at one connection, so these two transactions provably share a
  // backend. This is the exact condition a leaked `SET app.org_id` would exploit: the
  // second request borrows a backend still carrying the first request's context.

  it('org A sees only its own holding, then org B sees only its own, on one backend', async () => {
    const beforeA = await asOrg(orgA, 'select name from holding')
    expect(beforeA.rows.map((r) => r.name)).toEqual(['ONLYSOURCE stock'])

    const b = await asOrg(orgB, 'select name from holding')
    expect(b.rows.map((r) => r.name)).toEqual(['Fixture stock'])

    // And back again, because a leak can travel in either direction.
    const afterA = await asOrg(orgA, 'select name from holding')
    expect(afterA.rows.map((r) => r.name)).toEqual(['ONLYSOURCE stock'])
  })

  it('the two transactions really did share one physical backend', async () => {
    // If they did not, assertion 2 proves nothing about pooling. Measure it.
    const pidA = (await asOrg(orgA, 'select pg_backend_pid() as pid')).rows[0].pid
    const pidB = (await asOrg(orgB, 'select pg_backend_pid() as pid')).rows[0].pid
    expect(pidA).toBe(pidB)
  })

  it('org A cannot see org B by id even when it names it explicitly', async () => {
    const r = await asOrg(orgA, 'select id from org where id = $1', [orgB])
    expect(r.rowCount).toBe(0)
    // Positive control: naming its OWN id works, so the query itself is sound.
    const own = await asOrg(orgA, 'select id from org where id = $1', [orgA])
    expect(own.rowCount).toBe(1)
  })

  it('org A cannot INSERT a row belonging to org B', async () => {
    await expect(
      asOrg(orgA, `insert into holding (org_id, name) values ($1, 'smuggled')`, [orgB]),
    ).rejects.toThrow(/row-level security|violates/i)

    // Positive control: inserting into its OWN org succeeds.
    const ok = await asOrg(
      orgA,
      `insert into holding (org_id, name) values ($1, 'legitimate') returning id`,
      [orgA],
    )
    expect(ok.rowCount).toBe(1)
  })

  it('org A cannot UPDATE org B rows into its own org', async () => {
    const r = await asOrg(orgA, `update holding set name = 'stolen' where org_id = $1`, [orgB])
    expect(r.rowCount).toBe(0)
    // And org B's row is untouched, verified from outside the policy.
    const outside = new Client({ connectionString: db.superUrl })
    await outside.connect()
    const check = await outside.query(`select name from holding where org_id = $1`, [orgB])
    await outside.end()
    expect(check.rows.map((x) => x.name)).toContain('Fixture stock')
  })
})

// ===========================================================================================
describe('ASSERTION 3: no org context returns ZERO rows, not an error and not everything', () => {
  // Zero is the only safe answer. An error would be noisy but survivable; returning
  // everything is a cross-tenant breach that looks like a working query.

  it('returns zero rows from every Zone A table when app.org_id is unset', async () => {
    for (const table of ['org', 'holding', 'membership', 'invitation', 'capability_gate', 'audit_event']) {
      const r = await withNoOrgContext(`select * from ${table}`)
      expect(`${table}:${r.rowCount}`).toBe(`${table}:0`)
    }
  })

  it('does not throw. A missing context is not an exception path', async () => {
    await expect(withNoOrgContext('select * from holding')).resolves.toBeDefined()
  })

  it('positive control: the rows genuinely exist and are visible WITH context', async () => {
    // Without this, "zero rows" above would also pass on a completely empty database.
    const r = await asOrg(orgA, 'select * from holding')
    expect(r.rowCount).toBeGreaterThan(0)
  })

  it('an empty-string context is treated as unset, not as a wildcard', async () => {
    const r = await withRawOrgContext('', 'select * from holding')
    expect(r.rowCount).toBe(0)
  })
})

// ===========================================================================================
describe('ASSERTION 4: every unique index on a Zone A table is composite on org_id', () => {
  // A global UNIQUE on a Zone A table is a working existence oracle: org A learns what org B
  // has by attempting an insert and reading the conflict. No functional test ever catches
  // this. Only this assertion does.

  /*
   * ONE DOCUMENTED EXCEPTION, and it is deliberately a named allowlist rather than a
   * loosened rule.
   *
   * `invitation_token_key` is a GLOBAL unique on `invitation (token)` and it has to be.
   * An invite link is followed by somebody who has no session and no org yet, so the token
   * IS the lookup key and it cannot be scoped by an org the recipient does not have.
   *
   * Why it is not the existence oracle the rule exists to prevent: the token is at least
   * 128 bits from a CSPRNG, so the only thing a colliding insert reveals is that a value
   * the attacker already had to guess exists. RLS on `invitation` is still scoped on
   * org_id and forced, so no org can READ another's invitation row either way.
   *
   * The list is asserted to be EXACTLY this one entry, so nobody can quietly append to it.
   */
  const JUSTIFIED_GLOBAL_UNIQUES = new Set(['invitation_token_key'])

  it('the exception list contains exactly the one entry that is justified', () => {
    expect([...JUSTIFIED_GLOBAL_UNIQUES]).toEqual(['invitation_token_key'])
  })

  it('finds no single-column unique index that omits org_id', async () => {
    const r = await withNoOrgContext(`
      select t.relname as table_name, i.relname as index_name,
             array_agg(a.attname order by a.attnum) as cols
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_attribute a on a.attrelid = t.oid and a.attnum = any(x.indkey)
      where n.nspname = 'public'
        and x.indisunique
        and t.relname in ('holding','membership','invitation','capability_gate','audit_event')
      group by t.relname, i.relname
    `)

    const offenders = r.rows.filter(
      (row) =>
        !(row.cols as string[]).includes('org_id') &&
        !(row.index_name as string).endsWith('_pkey') &&
        !JUSTIFIED_GLOBAL_UNIQUES.has(row.index_name as string),
    )
    expect(
      offenders.map((o) => `${o.table_name}.${o.index_name}(${String(o.cols)})`),
    ).toEqual([])
  })

  it('positive control: the detector CAN see a violation when one exists', async () => {
    // Create a deliberately bad global unique index, prove the detector finds it, drop it.
    // A checker that has never returned a finding is not a checker.
    const owner = new Client({ connectionString: db.superUrl })
    await owner.connect()
    await owner.query(`create unique index bad_global_unique on holding (name)`)

    const r = await withNoOrgContext(`
      select t.relname as table_name, i.relname as index_name,
             array_agg(a.attname order by a.attnum) as cols
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_attribute a on a.attrelid = t.oid and a.attnum = any(x.indkey)
      where n.nspname = 'public' and x.indisunique and t.relname = 'holding'
      group by t.relname, i.relname
    `)
    const offenders = r.rows.filter(
      (row) =>
        !(row.cols as string[]).includes('org_id') &&
        !(row.index_name as string).endsWith('_pkey') &&
        !JUSTIFIED_GLOBAL_UNIQUES.has(row.index_name as string),
    )
    expect(offenders.map((o) => o.index_name)).toContain('bad_global_unique')

    await owner.query(`drop index bad_global_unique`)
    await owner.end()
  })
})

// ===========================================================================================
describe('ASSERTION 5: every org_id column cascades on org delete', () => {
  // One missing cascade means orphan rows that survive an org deletion and then surface in
  // a cross-org aggregate months later, with no way to tell whose they were.

  it('every org_id foreign key is ON DELETE CASCADE', async () => {
    const r = await withNoOrgContext(`
      select c.conrelid::regclass::text as table_name, c.confdeltype
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and a.attname = 'org_id'
    `)
    expect(r.rows.length).toBeGreaterThan(0)
    const notCascading = r.rows.filter((row) => row.confdeltype !== 'c')
    expect(notCascading.map((x) => x.table_name)).toEqual([])
  })

  it('deleting an org actually removes its rows, and leaves the other org intact', async () => {
    const owner = new Client({ connectionString: db.superUrl })
    await owner.connect()
    const temp = await owner.query(
      `insert into org (name, slug) values ('Doomed', 'doomed') returning id`,
    )
    const doomedId = temp.rows[0].id as string
    await owner.query(`insert into holding (org_id, name) values ($1, 'doomed stock')`, [doomedId])

    const before = await owner.query(`select count(*)::int as n from holding where org_id = $1`, [doomedId])
    expect(before.rows[0].n).toBe(1)

    await owner.query(`delete from org where id = $1`, [doomedId])

    const after = await owner.query(`select count(*)::int as n from holding where org_id = $1`, [doomedId])
    expect(after.rows[0].n).toBe(0)

    // The surviving org is untouched. A cascade that takes too much is also a defect.
    const survivor = await owner.query(`select count(*)::int as n from holding where org_id = $1`, [orgB])
    expect(survivor.rows[0].n).toBeGreaterThan(0)
    await owner.end()
  })
})

// ===========================================================================================
describe('THE HARNESS ITSELF CAN FAIL', () => {
  // A gate that has never been red is unproven. This runs the isolation query as a
  // SUPERUSER, who bypasses RLS by definition, and asserts it sees BOTH orgs. If this ever
  // returns one row, the harness is not actually reading through the policy layer and every
  // green result above is meaningless.
  it('a superuser bypasses the policy and sees both orgs, proving the policy is what filters', async () => {
    const owner = new Client({ connectionString: db.superUrl })
    await owner.connect()
    const r = await owner.query('select count(distinct org_id)::int as n from holding')
    await owner.end()
    expect(r.rows[0].n).toBeGreaterThanOrEqual(2)
  })

  it('app_runtime with context sees exactly one org, which is the contrast that matters', async () => {
    const r = await asOrg(orgA, 'select count(distinct org_id)::int as n from holding')
    expect(r.rows[0].n).toBe(1)
  })
})
