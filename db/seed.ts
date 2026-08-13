import { Client } from 'pg'

/**
 * THE ONLYSOURCE SEED. The operating org and the two real people, and nothing else.
 *
 * IT SEEDS NO SAMPLE DATA. No example requirement, no demo supplier, no placeholder
 * inventory. A seed is the easiest place in a codebase to smuggle in a convincing demo, and
 * house law 1 says real data or an honest empty state. A test asserts the absence: every
 * other table is still empty after this runs.
 *
 * IT IS IDEMPOTENT. A deploy script runs it every time, so running it twice must not create
 * a second org or a duplicate membership. Proven by a test that runs it three times.
 *
 * WHY IT DOES NOT SET PASSWORDS. Credentials are created through Better Auth so they are
 * hashed by the same code path that verifies them. A seed that writes a hash directly is a
 * second implementation of the most security-critical function in the system, and the two
 * drift. The two users are seeded WITHOUT credentials and complete setup through the
 * invitation flow, which also means no password ever exists in a file in this repo.
 *
 * IDENTITY, from _intel/BUILD-DIRECTIVE.md, which is authoritative:
 *   org   = ONLYSOURCE. David's company and the first operating org.
 *   users = David Hitchman (Owner, ProjectX) and David Goodreau (Admin, ProjectX).
 *   WKF / Wayne Friedman is NOT the operator. Prospective customer and the source of the
 *   illustrative domain examples. Nothing about WKF is seeded here.
 */

export const ONLYSOURCE_ORG = { name: 'ONLYSOURCE', slug: 'onlysource' } as const

export const SEEDED_USERS = [
  {
    id: 'usr_david_hitchman',
    name: 'David Hitchman',
    email: 'dhitchman@onlysource.ai',
    title: 'ProjectX',
    role: 'owner' as const,
  },
  {
    id: 'usr_david_goodreau',
    name: 'David Goodreau',
    email: 'dgoodreau@onlysource.ai',
    title: 'ProjectX',
    role: 'admin' as const,
  },
]

export async function seedOnlysource(connectionString: string): Promise<{ orgId: string }> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query('begin')

    // The org. `on conflict (slug) do update` rather than `do nothing`, so the name is
    // corrected on a rerun if it ever changes, and `returning` always yields the row.
    const org = await client.query(
      `insert into org (name, slug) values ($1, $2)
         on conflict (slug) do update set name = excluded.name
       returning id`,
      [ONLYSOURCE_ORG.name, ONLYSOURCE_ORG.slug],
    )
    const orgId = org.rows[0]!.id as string

    for (const user of SEEDED_USERS) {
      // Stable ids, so a rerun updates the same row rather than creating a second person
      // who happens to share an email. The unique index on lower(email) would catch that,
      // but relying on a constraint to enforce identity is relying on an error path.
      await client.query(
        `insert into app_user (id, name, email, title, email_verified)
         values ($1, $2, $3, $4, false)
         on conflict (id) do update
           set name = excluded.name, email = excluded.email, title = excluded.title,
               updated_at = now()`,
        [user.id, user.name, user.email, user.title],
      )

      await client.query(
        `insert into membership (org_id, user_id, role, status)
         values ($1, $2, $3, 'active')
         on conflict (org_id, user_id) do update
           set role = excluded.role, status = excluded.status`,
        [orgId, user.id, user.role],
      )
    }

    await client.query('commit')
    return { orgId }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}
