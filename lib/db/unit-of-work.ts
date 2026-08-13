import 'server-only'
import { Pool, type PoolClient } from 'pg'

/**
 * THE ONLY DOOR TO THE DATABASE.
 *
 * Every query in this application goes through `withOrg()` or `withoutOrg()`. A lint
 * forbids any other file from constructing a Pool or Client, and it ships with a known-bad
 * fixture proving it fires. Per-route discipline decays; a single door does not.
 *
 * ==========================================================================================
 * WHY `SET LOCAL` AND NOT `SET`. This is the failure that kills serverless Postgres apps.
 * ==========================================================================================
 * A transaction-mode pooler hands a backend to a request for the duration of a TRANSACTION,
 * then gives it to somebody else. PgBouncer documents SET/RESET as never supported in
 * transaction pooling. So a bare `SET app.org_id` either vanishes before the query runs, or
 * survives on the backend and leaks one org's context onto the NEXT request that borrows it.
 * The second one is worse: it is a cross-tenant read that looks like a normal query.
 *
 * `SET LOCAL` inside an explicit transaction is scoped to that transaction and is released
 * on commit or rollback, which is exactly the lifetime the pooler guarantees.
 *
 * ==========================================================================================
 * WHY NO EXTERNAL I/O INSIDE. Quality Bar R13.
 * ==========================================================================================
 * A transaction that awaits an HTTP call holds a pooled connection for the latency of
 * somebody else's server. Under the daily ingest load that exhausts the pool and the whole
 * application stops. The transaction is for database work only. Fetch first, then open.
 *
 * ==========================================================================================
 * THE CLIENT NEVER NAMES THE ORG.
 * ==========================================================================================
 * `orgId` here is resolved SERVER-side from the session and the membership table. An org id
 * arriving in a request body, a header, or a client-held cookie value is a bug, and a lint
 * says so. See `resolveActiveOrg()` in lib/auth.
 */

let runtimePool: Pool | null = null

function pool(): Pool {
  if (runtimePool) return runtimePool
  const connectionString = process.env.DATABASE_URL_RUNTIME
  if (!connectionString) {
    // Fails closed and says which variable is missing. It does not fall back to the
    // migrator URL, because falling back to the owner is precisely how RLS becomes
    // decorative while every test still passes.
    throw new Error(
      'DATABASE_URL_RUNTIME is not set. The application connects as app_runtime and never as the table owner.',
    )
  }
  runtimePool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Prepared statements are disabled at the pooler, so do not rely on them here either.
    statement_timeout: 30_000,
  })
  return runtimePool
}

/** Swap the pool. Tests only, so the harness can point at a throwaway server. */
export function installTestPool(p: Pool | null): void {
  runtimePool = p
}

export async function closePool(): Promise<void> {
  await runtimePool?.end()
  runtimePool = null
}

export type Tx = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number }>
}

function wrap(client: PoolClient): Tx {
  return {
    async query(text, values) {
      const result = await client.query(text, values as never[])
      return { rows: result.rows as never[], rowCount: result.rowCount ?? 0 }
    },
  }
}

/**
 * Run a short transaction with the org context set for its whole lifetime.
 *
 * Everything an org owns is read and written through here. If `orgId` is malformed the
 * transaction never opens, because passing an unvalidated string into `set_config` is how
 * an injection reaches the one setting the entire isolation model depends on.
 */
export async function withOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
    throw new Error('withOrg: orgId is not a uuid. It must come from the session, never a client value.')
  }

  const client = await pool().connect()
  try {
    await client.query('begin')
    // Parameterised, and `true` makes it transaction-local. Never string-interpolated.
    await client.query('select set_config($1, $2, true)', ['app.org_id', orgId])
    const out = await fn(wrap(client))
    await client.query('commit')
    return out
  } catch (err) {
    try {
      await client.query('rollback')
    } catch {
      // A rollback failure means the connection is already gone. Releasing it below with
      // the error flag discards it rather than returning a poisoned backend to the pool.
    }
    throw err
  } finally {
    client.release()
  }
}

/**
 * Run a transaction with NO org context, for the identity plane and the shared national
 * corpus only.
 *
 * This exists because `app_user`, `session` and `account` are not org-scoped: one human is
 * one row with many memberships. It is deliberately a SEPARATE, awkwardly named function
 * rather than `withOrg(null)`, so that reaching for it is a visible decision in review and
 * greppable in an audit. Every Zone A table has RLS forced, so if this is ever pointed at
 * one it returns zero rows rather than everything.
 */
export async function withoutOrg<T>(
  reason: 'identity-plane' | 'national-corpus' | 'migration-check',
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool().connect()
  try {
    await client.query('begin')
    const out = await fn(wrap(client))
    await client.query('commit')
    return out
  } catch (err) {
    try {
      await client.query('rollback')
    } catch {
      /* connection already gone */
    }
    throw err
  } finally {
    client.release()
  }
  // `reason` is unused at runtime on purpose: it exists to force the caller to state which
  // of the three legitimate cases this is, in code, where a reviewer can see it.
}
