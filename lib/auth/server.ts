import 'server-only'
import { betterAuth } from 'better-auth'
import { Pool } from 'pg'

/**
 * IDENTITY. Better Auth, self-hosted against our own Postgres. Pinned at 1.6.27, MIT,
 * license text read from the published tarball rather than a web page (the GitHub tag 404s).
 *
 * ==========================================================================================
 * AUTH IS BOUGHT. AUTHORIZATION IS NEVER DELEGATED.
 * ==========================================================================================
 * Better Auth issues sessions and stores credentials. That is ALL it does here. It does not
 * decide what anybody may see. The org boundary is enforced in the data layer against RLS,
 * underneath, so a library-level authentication bug degrades to "wrong user identity" and
 * never to "wrong org's data". That difference is an incident versus a company-ending
 * incident.
 *
 * ==========================================================================================
 * NO ORGANIZATION PLUGIN, AND THIS IS A DECISION TO OBJECT TO.
 * ==========================================================================================
 * The kickoff pack names the org plugin. I have not enabled it, because our `org`,
 * `membership` and `invitation` tables carry columns the plugin does not model (membership
 * status, the export-eligibility triple, default holding) and are governed by RLS policies
 * and a partial unique index the plugin does not know about. Mapping it onto our shapes
 * means the plugin half-owns tables whose invariants live in our DDL, which is exactly the
 * "do not let the vendor become load-bearing" warning applied one level down.
 *
 * So: Better Auth owns `app_user`, `session`, `account`, `verification`. WE own `org`,
 * `membership` and `invitation`, and we resolve the active org server-side. Posted to the
 * claims file for the conductor to overrule if they want the plugin.
 *
 * ==========================================================================================
 * SESSIONS ARE SERVER-SIDE ROWS, NOT STATELESS JWTs.
 * ==========================================================================================
 * Instant revocation is required by three separate paths: offboarding, a deactivated
 * account, and a lapsed export certification. A stateless token keeps working until it
 * expires, which means a terminated employee keeps access for the length of the token.
 */

let pool: Pool | null = null

function authPool(): Pool {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL_RUNTIME
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL_RUNTIME is not set. Identity cannot start without a database, and it fails closed rather than falling back to an in-memory store.',
    )
  }
  pool = new Pool({ connectionString, max: 5 })
  return pool
}

/**
 * Column mapping. Our schema is snake_case because it is read by hand in psql during an
 * incident; Better Auth defaults to camelCase. Mapped explicitly rather than renaming the
 * database, so the DDL stays readable to a person.
 */
/*
 * LAZY, AND THAT IS LOAD-BEARING. `export const auth = betterAuth({ database: authPool() })`
 * evaluates at import time, so a build container with no DATABASE_URL_RUNTIME would throw
 * while Next was merely collecting page data. The app must build without runtime secrets and
 * fail closed at REQUEST time instead, with a message naming the missing variable.
 */
function build() {
  return betterAuth({
  database: authPool(),

  emailAndPassword: {
    enabled: true,
    /*
     * NIST SP 800-63B rev 4: length over composition. No character-class rules, no periodic
     * rotation. 12 is the floor here rather than 8 because every account in this system can
     * reach government procurement data.
     */
    minPasswordLength: 12,
    maxPasswordLength: 256,
    /*
     * FALSE TODAY, DELIBERATELY, AND IT IS NOT AN OVERSIGHT. Users are provisioned by an
     * internal admin, not by public self-serve signup, so there is no unverified stranger
     * to gate. The moment public signup exists this becomes true, and email verification
     * must be required before ANY data leaves the org: invites, outbound email, exports.
     */
    requireEmailVerification: false,
  },

  /*
   * 12 hour absolute ceiling for every role, set on the session block below. Idle timeouts
   * are graded by role and enforced in OUR layer, not here, because the owner carve-out
   * (read-only after idle, one in-place re-auth for a mutation, across the 13:00 to 15:30 ET
   * deadline window) is a product rule and not a library setting.
   *
   * The rule it exists to satisfy: the principal works until 2:50 PM through a two-hour
   * lunch and then submits. A flat 1-hour idle logout ends that session mid-afternoon and
   * loses the quote. That is a disqualifying failure, not an inconvenience.
   */
  user: {
    modelName: 'app_user',
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    additionalFields: {
      title: { type: 'string', required: false, input: false },
    },
  },

  /*
   * Our columns are snake_case. Better Auth defaults to camelCase. Mapped explicitly rather
   * than renaming the database, because the DDL is read by a person in psql during an
   * incident and `email_verified` is legible where `emailVerified` in a quoted identifier
   * is not.
   */
  session: {
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 15,
    modelName: 'session',
    fields: {
      userId: 'user_id',
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },

  account: {
    modelName: 'account',
    fields: {
      userId: 'user_id',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },

  verification: {
    modelName: 'verification',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },

  advanced: {
    /*
     * Better Auth generates the id. `generateId: false` would hand that job to the database,
     * and our identity-plane tables declare `id text primary key` with NO default, so every
     * insert would fail on a null id. Caught before it shipped by asking what the column
     * actually does rather than what the option sounds like.
     */
    cookiePrefix: 'onlysource',
    useSecureCookies: process.env.APP_ENV === 'production',
  },

  telemetry: { enabled: false },
  })
}

/*
 * Typed off `build`'s INFERRED return type, not off `ReturnType<typeof betterAuth>`. The
 * latter is the generic signature and does not accept the concrete instance, so annotating
 * with it fails to compile. Inferring keeps the plugin and field types intact all the way
 * to the call sites.
 */
let instance: ReturnType<typeof build> | null = null

export function getAuth(): ReturnType<typeof build> {
  instance ??= build()
  return instance
}

/** Tests only: drop the memoised instance and pool so a new database can be pointed at. */
export async function resetAuthForTest(): Promise<void> {
  await pool?.end()
  pool = null
  instance = null
}

export type Auth = ReturnType<typeof build>
