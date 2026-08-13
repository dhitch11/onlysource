import { afterEach, describe, expect, it } from 'vitest'
import { secretAad } from '@/lib/vault/aad'
import { open, seal } from '@/lib/vault/envelope'
import { secretFingerprint, secretLast4 } from '@/lib/vault/fingerprint'
import {
  guardRawConnection,
  toPublicConnection,
  type StoredConnection,
} from '@/lib/vault/public-connection'
import { installTestLogger, log, errorFields } from '@/lib/log'
import { systemClock } from '@/lib/time/clock'

/**
 * THE CREDENTIAL CANARY (gate R0.2).
 *
 * The charter is precise about why this exists and how it must be written:
 *
 *   "plant a canary credential, exercise every connector path, and grep every log sink, every
 *    stored error payload, every APM trace and every recorded LLM request for the literal
 *    value. A grep for the field name proves nothing; a grep for the value is evidence. The
 *    canary test passes BEFORE any real credential is stored."
 *
 * This is the unit-level half, covering every sink reachable without a running app: the logger,
 * thrown error messages AND stacks, the public projection, and JSON serialization of the raw
 * row. The CI half (APM traces, recorded model requests, stored error payloads) attaches to the
 * R0 harness once `scripts/` exists; it is filed as blocker B-T7-3 and is not silently skipped.
 *
 * THE POSITIVE CONTROL IS THE MOST IMPORTANT TEST IN THIS FILE. A canary grep that cannot
 * detect a leak passes green forever while credentials pour into the logs. So one test
 * deliberately leaks the canary and asserts the detector CATCHES it. If that test ever goes
 * green-by-passing rather than green-by-catching, the whole file is worthless.
 */

// A value with no substring collisions against normal output, so a hit is unambiguous.
const CANARY = 'CANARY-b7f3e1a9d4c62580-DO-NOT-LOG'
const PEPPER = Buffer.from('pepper-for-tests-only-not-a-real-one', 'utf8')
const KEY = Buffer.alloc(32, 3)
const HOLDING = '11111111-1111-4111-8111-111111111111'
const CONN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** Everything written anywhere during a scenario. The thing we grep. */
let sinks: string[] = []
let restoreLogger: (() => void) | null = null

function captureLogs(): void {
  restoreLogger = installTestLogger((line) => sinks.push(line), systemClock)
}

afterEach(() => {
  restoreLogger?.()
  restoreLogger = null
  sinks = []
})

/** The detector itself, kept as one function so the control and the real tests share it. */
function canaryLeaked(captured: string[]): boolean {
  return captured.some((s) => s.includes(CANARY))
}

function storedRow(sealed: ReturnType<typeof seal>): StoredConnection {
  return guardRawConnection({
    id: CONN,
    org_id: '33333333-3333-4333-8333-333333333333',
    holding_id: HOLDING,
    connector_slug: 'dibbs-vendor',
    name: 'DIBBS vendor login',
    status: 'healthy',
    secret_ct: sealed.ct,
    secret_iv: sealed.iv,
    secret_tag: sealed.tag,
    secret_fingerprint: secretFingerprint(CANARY, PEPPER),
    secret_last4: secretLast4(CANARY),
    config: { host: 'dibbs.bsm.dla.mil' },
    expires_at: null,
    last_tested_at: new Date('2026-08-13T12:00:00Z'),
    last_test_ok: true,
    last_test_reason: 'ok',
    last_success_at: new Date('2026-08-13T12:00:00Z'),
    created_by: 'david.hitchman',
    created_at: new Date('2026-08-13T09:00:00Z'),
  })
}

describe('CANARY DETECTOR: prove the instrument can fail', () => {
  it('CATCHES a deliberate leak (POSITIVE CONTROL, the load-bearing test in this file)', () => {
    captureLogs()
    // Simulate the exact mistake this gate exists to prevent: a developer logs the secret in a
    // field the allow-list does not cover. `lib/log.ts` redacts unlisted FIELD NAMES, so this
    // particular leak is caught by redaction too, which is why the control also leaks through a
    // channel redaction does not cover: the message string itself.
    log.info(`connecting with ${CANARY}`, {})
    expect(canaryLeaked(sinks)).toBe(true)
  })

  it('does not fire on output that never contained the canary (NEGATIVE CONTROL)', () => {
    captureLogs()
    log.info('connection tested', { outcome: 'ok' })
    expect(canaryLeaked(sinks)).toBe(false)
  })
})

describe('CANARY: the vault leaks it through no sink', () => {
  it('survives a full seal, open and project cycle without reaching any sink', () => {
    captureLogs()
    const aad = secretAad(HOLDING, CONN)
    const sealed = seal(Buffer.from(CANARY, 'utf8'), KEY, aad)
    const row = storedRow(sealed)

    // The unwrap path, as production runs it.
    const opened = open(sealed, KEY, aad, CONN)
    expect(opened.toString('utf8')).toBe(CANARY)

    // The audit line an unwrap is required to write. Actor, connection, reason, never the value.
    log.info('vault.unwrap', { outcome: 'ok', reason: 'health_probe' })

    // The boundary projection, and its serialized form, which is what a route returns.
    const pub = toPublicConnection(row, { connectorIsIntegrated: false })
    sinks.push(JSON.stringify(pub))

    // The ciphertext columns as base64, which is how they would appear if a row were dumped.
    sinks.push(sealed.ct.toString('base64'), sealed.tag.toString('base64'))

    expect(canaryLeaked(sinks)).toBe(false)
  })

  it('does not leak through a thrown error message or its stack', () => {
    const aad = secretAad(HOLDING, CONN)
    const sealed = seal(Buffer.from(CANARY, 'utf8'), KEY, aad)
    // Force the failure path: wrong holding, the copied-ciphertext case.
    const wrongAad = secretAad('22222222-2222-4222-8222-222222222222', CONN)
    try {
      open(sealed, KEY, wrongAad, CONN)
      throw new Error('expected the vault to refuse')
    } catch (err) {
      const captured = [
        (err as Error).message,
        (err as Error).stack ?? '',
        JSON.stringify(errorFields(err)),
      ]
      expect(canaryLeaked(captured)).toBe(false)
    }
  })

  it('does not leak the canary through the public projection', () => {
    const sealed = seal(Buffer.from(CANARY, 'utf8'), KEY, secretAad(HOLDING, CONN))
    const pub = toPublicConnection(storedRow(sealed), { connectorIsIntegrated: false })
    const serialized = JSON.stringify(pub)

    expect(serialized).not.toContain(CANARY)
    // The fingerprint is published only as a short prefix, never in full: published whole it
    // becomes a confirmation oracle for anyone who later obtains the pepper.
    expect(serialized).not.toContain(secretFingerprint(CANARY, PEPPER))
    expect(pub.secretFingerprintShort).toHaveLength(8)
    // Presence is published; the value never is.
    expect(pub.hasSecret).toBe(true)
  })

  it('REFUSES to serialize the raw row at all', () => {
    // The runtime backstop behind the R0.1 lint. A prompt builder doing JSON.stringify(context)
    // must fail loudly at the leak site rather than quietly emit base64 ciphertext.
    const sealed = seal(Buffer.from(CANARY, 'utf8'), KEY, secretAad(HOLDING, CONN))
    const row = storedRow(sealed)
    expect(() => JSON.stringify(row)).toThrow(/Refusing to serialize a raw connection row/)
  })
})

describe('CANARY: last4 refuses to hint at a short secret', () => {
  it('gives no hint below the threshold, and a hint above it', () => {
    expect(secretLast4('short1234')).toBeNull()
    expect(secretLast4(CANARY)).toBe(CANARY.slice(-4))
  })
})
