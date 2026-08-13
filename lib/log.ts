import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { systemClock, type Clock } from './time/clock'

/**
 * Structured logging. Every line is one JSON object, and every line carries the tenant.
 *
 * THE REDACTION MODEL IS AN ALLOW-LIST, KEYED ON FIELD NAME, NOT A VALUE HEURISTIC.
 *
 * That choice is the whole point. A deny-list only redacts the secret shapes somebody
 * thought of, and a value heuristic (does this look like a token) is a guess that fails on
 * the first credential that looks like a word. An allow-list fails the other way: a field
 * nobody listed is redacted, which is loud, cheap, and safe.
 *
 * Redacted keys are emitted as `[redacted:unlisted]` rather than dropped, because a field
 * that silently vanishes is indistinguishable from a field nobody logged, and the second
 * one is a debugging dead end at 2 AM.
 *
 * The concrete reason this ships on day one rather than after the first incident: the
 * corpus that seeds this build already carries live plaintext credentials, flagged twice.
 * The first credential that reaches a log sink is a rotation event, not a cleanup task.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Field names permitted to appear in a log line WITH THEIR VALUE.
 *
 * Adding a name here is a security decision. The R0 `redaction-allow-list` lint fails the
 * build if a name on the denied list below is ever added to this set, and it ships with a
 * known-bad fixture proving it fires.
 */
export const ALLOWED_LOG_FIELDS = new Set<string>([
  // identity and tenancy
  'org_id',
  'tenant_id',
  'actor_id',
  'staff_id',
  'membership_role',
  'impersonated_by',
  // request shape
  'request_id',
  'route',
  'method',
  'status',
  'duration_ms',
  'user_agent_family',
  // domain identifiers, none of which are secret
  'solicitation_number',
  'niin',
  'cage',
  'requirement_id',
  'document_id',
  'job_id',
  'job_kind',
  'attempt',
  // outcomes
  'outcome',
  'reason',
  'error_kind',
  'error_message',
  'count',
  'rows',
  'gate',
  'probe_landed',
  'gate_fired',
  // deploy identity
  'env',
  'commit',
  'region',
])

/**
 * Names that must NEVER be added to the allow-list. Checked by lint, not by review.
 * Matching is on the normalised field name and on any name that contains one of these.
 */
export const DENIED_LOG_FIELD_SUBSTRINGS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'session_id',
  'api_key',
  'apikey',
  'private_key',
  'credential',
  'dek',
  'ssn',
  'bearer',
]

export type LogContext = {
  org_id?: string
  actor_id?: string
  request_id?: string
  route?: string
}

const contextStore = new AsyncLocalStorage<LogContext>()

/** Run `fn` with request-scoped log context. Every line inside inherits it. */
export function withLogContext<T>(context: LogContext, fn: () => T): T {
  const merged = { ...(contextStore.getStore() ?? {}), ...context }
  return contextStore.run(merged, fn)
}

export function currentLogContext(): LogContext {
  return contextStore.getStore() ?? {}
}

export type LogFields = Record<string, unknown>

/** Apply the allow-list. Exported so the lint self-test and unit tests can prove it works. */
export function redactFields(fields: LogFields): LogFields {
  const out: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    out[key] = ALLOWED_LOG_FIELDS.has(key) ? value : '[redacted:unlisted]'
  }
  return out
}

type Sink = (line: string) => void

let sink: Sink = (line) => {
  // The one sanctioned write to stdout. Everything else goes through this module, which is
  // what the `no-bare-console` lint enforces.
  process.stdout.write(`${line}\n`)
}

let clock: Clock = systemClock

/** Swap the sink and clock. Tests only. Returns a restore function. */
export function installTestLogger(testSink: Sink, testClock: Clock): () => void {
  const previousSink = sink
  const previousClock = clock
  sink = testSink
  clock = testClock
  return () => {
    sink = previousSink
    clock = previousClock
  }
}

function emit(level: LogLevel, msg: string, fields: LogFields): void {
  const ctx = currentLogContext()
  const line = {
    ts: new Date(clock.now()).toISOString(),
    level,
    msg,
    // The tenant is on EVERY line. `null` is a real answer meaning "no tenant resolved
    // yet", which is different from the key being absent and impossible to grep for.
    org_id: ctx.org_id ?? null,
    actor_id: ctx.actor_id ?? null,
    request_id: ctx.request_id ?? null,
    route: ctx.route ?? null,
    env: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'unknown',
    commit: process.env.GIT_COMMIT_SHA?.slice(0, 8) ?? null,
    ...redactFields(fields),
  }
  sink(JSON.stringify(line))
}

export const log = {
  debug: (msg: string, fields: LogFields = {}) => emit('debug', msg, fields),
  info: (msg: string, fields: LogFields = {}) => emit('info', msg, fields),
  warn: (msg: string, fields: LogFields = {}) => emit('warn', msg, fields),
  error: (msg: string, fields: LogFields = {}) => emit('error', msg, fields),
}

/**
 * Normalise a thrown value into loggable fields.
 *
 * `error_message` is on the allow-list deliberately, and that is a considered risk: an
 * exception message can carry a value from the input that produced it. The mitigation is
 * that this helper never logs a stack or a cause chain, both of which routinely carry
 * connection strings.
 */
export function errorFields(err: unknown): LogFields {
  if (err instanceof Error) {
    return { error_kind: err.name, error_message: err.message }
  }
  return { error_kind: 'unknown', error_message: String(err) }
}
