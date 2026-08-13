import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import { Client, Pool } from 'pg'

/**
 * A REAL PostgreSQL server for the isolation harness.
 *
 * Real, not a mock and not sqlite, because the thing under test is row level security,
 * role privileges, and what `SET LOCAL` does across a transaction boundary. None of that
 * exists in a fake, so a fake would test nothing and report green.
 *
 * `embedded-postgres` unpacks genuine PostgreSQL binaries into node_modules, so this runs
 * with no Docker, nothing installed system-wide, and identically in CI. That was the whole
 * of blocker B3.
 *
 * The harness models PRODUCTION ROLES rather than convenience:
 *   the migration runs as a superuser, then table ownership is handed to `app_migrator`,
 *   and every assertion connects as `app_runtime`, which owns nothing.
 * Connecting the assertions as the owner would make every policy decorative and every test
 * pass, which is the one defect this harness exists to catch.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url))
const RUNTIME_PASSWORD = 'test-runtime-password-not-a-secret'

export type TestDatabase = {
  runtimeUrl: string
  migratorUrl: string
  superUrl: string
  runtimePool: Pool
  stop: () => Promise<void>
}

export async function startTestDatabase(port: number): Promise<TestDatabase> {
  const databaseDir = join(
    fileURLToPath(new URL('../../tmp', import.meta.url)),
    `pgdata-${port}`,
  )

  // A leftover data directory from an interrupted run makes initialise() exit 1 with a
  // message about the directory already existing, which reads like a Postgres problem and
  // is not one. Clear it first so a rerun is always clean. This cost me a confused probe.
  rmSync(databaseDir, { recursive: true, force: true })

  const server = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })

  await server.initialise()
  await server.start()
  await server.createDatabase('onlysource_test')

  const superUrl = `postgresql://postgres:postgres@localhost:${port}/onlysource_test`

  // ---- migrate as a superuser, exactly as a deploy would ----
  const migrator = new Client({ connectionString: superUrl })
  await migrator.connect()

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort() // numbered, so lexical order is apply order
  for (const file of files) {
    await migrator.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  }

  // ---- model production ownership: app_migrator owns, app_runtime owns nothing ----
  await migrator.query(`
    do $$
    declare t record;
    begin
      for t in select tablename from pg_tables where schemaname = 'public'
      loop
        execute format('alter table public.%I owner to app_migrator', t.tablename);
      end loop;
    end
    $$;
  `)
  await migrator.query(
    `alter role app_runtime with password '${RUNTIME_PASSWORD}'`,
  )
  await migrator.end()

  const runtimeUrl = `postgresql://app_runtime:${RUNTIME_PASSWORD}@localhost:${port}/onlysource_test`
  const migratorUrl = `postgresql://app_migrator@localhost:${port}/onlysource_test`

  // A small pool ON PURPOSE. Assertion 2 needs two different orgs to land on the SAME
  // physical backend one after the other, which is the real-world condition that a leaked
  // `SET` would exploit. max: 1 guarantees it rather than hoping for it.
  const runtimePool = new Pool({ connectionString: runtimeUrl, max: 1 })

  return {
    runtimeUrl,
    migratorUrl,
    superUrl,
    runtimePool,
    async stop() {
      await runtimePool.end()
      await server.stop()
    },
  }
}

/** Seed two orgs so cross-org reads have something real to fail to read. */
export async function seedTwoOrgs(superUrl: string): Promise<{ orgA: string; orgB: string }> {
  const client = new Client({ connectionString: superUrl })
  await client.connect()
  const a = await client.query(
    `insert into org (name, slug) values ('ONLYSOURCE', 'onlysource') returning id`,
  )
  const b = await client.query(
    `insert into org (name, slug) values ('Fixture Org', 'fixture-org') returning id`,
  )
  const orgA = a.rows[0]!.id as string
  const orgB = b.rows[0]!.id as string

  await client.query(
    `insert into holding (org_id, name, kind) values ($1, 'ONLYSOURCE stock', 'internal')`,
    [orgA],
  )
  await client.query(
    `insert into holding (org_id, name, kind) values ($1, 'Fixture stock', 'internal')`,
    [orgB],
  )
  await client.end()
  return { orgA, orgB }
}
