import 'server-only'

/**
 * THE SERIALIZATION BOUNDARY. This module is the only sanctioned way a connection leaves the
 * vault, and everything about it is shaped by one rule from the charter:
 *
 *   "Redaction is an allow-list at the serialization boundary, not a deny-list."
 *
 * A deny-list of field names fails the moment somebody adds `apiKeySecondary`, and it fails
 * silently, at the exact moment a new credential type is introduced. An allow-list fails the
 * other way: a field nobody listed simply does not appear, which is loud, cheap and safe. This
 * is the same model `lib/log.ts` already applies to log fields, and it is deliberate that the
 * two agree.
 *
 * TWO CONTROLS LIVE HERE, AND THE SECOND ONE IS THE ONE THAT ACTUALLY CATCHES MISTAKES:
 *   1. `toPublicConnection` names every safe field explicitly. Nothing is spread, ever.
 *   2. `guardRawConnection` makes the raw row THROW on JSON serialization, so
 *      `JSON.stringify(row)` in a prompt builder, a log line or an error payload fails loudly
 *      instead of leaking. The charter's words are "a connection object must never be
 *      serializable into a prompt"; this makes that literally true at runtime rather than by
 *      convention.
 */

/**
 * The raw row, secret-bearing. NEVER leaves this module.
 *
 * The R0.1 lint forbids importing this type outside `lib/vault/`. The lint is necessary but not
 * sufficient, which is why `guardRawConnection` exists as a runtime backstop: a lint catches the
 * import, the guard catches the serialization the import would have enabled.
 */
export type StoredConnection = {
  id: string
  org_id: string
  holding_id: string
  connector_slug: string
  name: string
  status: ConnectionStatus
  /** AES-256-GCM parts. Meaningless without the DEK and the reconstructed AAD. */
  secret_ct: Buffer
  secret_iv: Buffer
  secret_tag: Buffer
  /** HMAC under the server pepper. Not reversible, but still not published. */
  secret_fingerprint: string
  secret_last4: string | null
  /** NON-SECRET settings only. Enforced by the connector's `config_schema`. */
  config: Record<string, unknown>
  expires_at: Date | null
  last_tested_at: Date | null
  last_test_ok: boolean | null
  last_test_reason: HealthReason | null
  last_success_at: Date | null
  created_by: string
  created_at: Date
}

/**
 * The stored lifecycle state of a connection row.
 *
 * Distinct from the DISPLAY state below, and the distinction matters: `unconfigured` and
 * `failed` are different rows in the database, and `not_connected` and `failing` are different
 * sentences on a screen. Collapsing either pair is how an operator ends up unable to tell "we
 * never set this up" from "this broke an hour ago".
 */
export type ConnectionStatus =
  | 'unconfigured'
  | 'untested'
  | 'healthy'
  | 'degraded'
  | 'expired'
  | 'failed'
  | 'disabled'

/** Health-probe outcomes in operator language, per charter 4.4 / api-webhooks-integrations 9.5. */
export type HealthReason =
  | 'ok'
  | 'auth_failed'
  | 'not_found'
  | 'rate_limited'
  | 'provider_error'
  | 'timeout'
  | 'dns'
  | 'tls'
  | 'assertion_failed'

/**
 * The four honest display states, rendered distinctly. Charter 4.4.
 *
 * `connected_raw` versus `connected_integrated` is a house-law-1 requirement, not a nicety: a
 * single green dot implying data flows into scoring when the truth is authenticated pass-through
 * is a fabrication in a settings screen.
 */
export type DisplayState =
  | 'not_connected'
  | 'connected_raw'
  | 'connected_integrated'
  | 'failing'

/** The ONLY shape any route, log line, component or model prompt may receive. */
export type PublicConnection = {
  id: string
  holdingId: string
  connectorSlug: string
  name: string
  /** What the operator sees. Derived, never stored, so it cannot drift from the row. */
  display: DisplayState
  /** The stored lifecycle value, for admin surfaces that need the precise state. */
  status: ConnectionStatus
  /** Presence only. True means a credential exists; it never implies it works. */
  hasSecret: boolean
  /**
   * A short, non-reversible hint so two connections holding the same credential are visibly the
   * same. The full fingerprint stays server-side: published in full it becomes a confirmation
   * oracle for anyone who steals the pepper later.
   */
  secretFingerprintShort: string | null
  secretLast4: string | null
  expiresAt: string | null
  lastTestedAt: string | null
  lastTestOk: boolean | null
  lastTestReason: HealthReason | null
  lastSuccessAt: string | null
  createdBy: string
  createdAt: string
}

/**
 * Project a stored row to its public shape.
 *
 * Every field is named. There is no spread and there will not be one: a spread means the next
 * secret-bearing column added to the table is published the day it is added, by a developer who
 * changed a migration and never looked at this file.
 */
export function toPublicConnection(
  row: StoredConnection,
  opts: { connectorIsIntegrated: boolean },
): PublicConnection {
  return {
    id: row.id,
    holdingId: row.holding_id,
    connectorSlug: row.connector_slug,
    name: row.name,
    display: displayStateOf(row.status, opts.connectorIsIntegrated),
    status: row.status,
    hasSecret: row.secret_ct.length > 0,
    secretFingerprintShort: row.secret_fingerprint ? row.secret_fingerprint.slice(0, 8) : null,
    secretLast4: row.secret_last4,
    expiresAt: row.expires_at?.toISOString() ?? null,
    lastTestedAt: row.last_tested_at?.toISOString() ?? null,
    lastTestOk: row.last_test_ok,
    lastTestReason: row.last_test_reason,
    lastSuccessAt: row.last_success_at?.toISOString() ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  }
}

/**
 * Derive what the operator is told.
 *
 * `degraded` deliberately reads as `failing` rather than as a fourth shade of connected. An
 * operator deciding whether to trust a scored output needs to know the feed is not right; the
 * precise degree belongs on the admin surface, which reads `status` directly.
 */
export function displayStateOf(
  status: ConnectionStatus,
  connectorIsIntegrated: boolean,
): DisplayState {
  switch (status) {
    case 'unconfigured':
    case 'disabled':
      return 'not_connected'
    case 'failed':
    case 'expired':
    case 'degraded':
      return 'failing'
    case 'untested':
    case 'healthy':
      return connectorIsIntegrated ? 'connected_integrated' : 'connected_raw'
  }
}

/**
 * Make a raw connection row throw if anything tries to serialize it.
 *
 * Call this on every row the moment it leaves the database driver. The cost is one property
 * definition; the payoff is that the three most common credential-leak paths (a prompt builder
 * doing `JSON.stringify(context)`, a logger given the whole object, an error handler attaching
 * request state) fail loudly at the leak site instead of succeeding quietly.
 *
 * `Buffer` fields would serialize to readable base64 without this, so the leak it prevents is
 * real rather than theoretical.
 */
export function guardRawConnection<T extends StoredConnection>(row: T): T {
  Object.defineProperty(row, 'toJSON', {
    enumerable: false,
    configurable: false,
    writable: false,
    value() {
      throw new Error(
        'Refusing to serialize a raw connection row. It carries credential ciphertext. ' +
          'Use toPublicConnection() at the boundary instead.',
      )
    },
  })
  return row
}
