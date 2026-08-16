import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ALERT_FROM,
  ALLOWED_RECIPIENTS,
  BLOCKED_RECIPIENTS,
  emailArmed,
  recipientAllowed,
  sendEmail,
  sendPreflight,
} from '@/lib/notify/email'

/**
 * THE EMAIL GUARDS. Owner ruling 2026-08-16, and the reason this suite exists at all.
 *
 * An autonomous daily cron was sending a digest without anybody asking for it. The owner's
 * instruction was to build the capability and stop the sending: "definitely should not be sending
 * any emails. Everything should get ready to be able to send them." Platform updates go to
 * david@reddenda.com only, and david@sminet.org must not receive them.
 *
 * A rule that lives in a settings file is a rule the next lane edits without knowing why it was
 * set. These are enforced in code, and this suite is what stops a future edit from quietly
 * loosening them. Every refusal below is paired with a POSITIVE CONTROL proving the same function
 * ALLOWS the correct case, so a module that refused everything would fail here rather than pass.
 */

const KEY = 'ONLYSOURCE_RESEND_KEY'
const ARM = 'ONLYSOURCE_EMAIL_ARMED'
const prev: Record<string, string | undefined> = {}

beforeEach(() => {
  prev[KEY] = process.env[KEY]
  prev[ARM] = process.env[ARM]
})

afterEach(() => {
  for (const k of [KEY, ARM]) {
    if (prev[k] === undefined) delete process.env[k]
    else process.env[k] = prev[k]
  }
})

describe('the sender is the address the owner named', () => {
  it('defaults to david@reddenda.org, not the old info@reddenda.com', () => {
    // Defaulting to the ruling rather than to the previous value means an unset environment
    // variable lands on the CORRECT address instead of silently reverting.
    expect(ALERT_FROM).toContain('david@reddenda.org')
    expect(ALERT_FROM).not.toContain('info@reddenda.com')
  })
})

describe('sending is disarmed unless explicitly armed', () => {
  it('is disarmed when the variable is absent', () => {
    delete process.env[ARM]
    expect(emailArmed()).toBe(false)
  })

  it('is disarmed for every value that is not exactly "true"', () => {
    for (const v of ['', 'false', 'TRUE', '1', 'yes', 'True']) {
      process.env[ARM] = v
      expect(emailArmed(), `"${v}" must not arm sending`).toBe(false)
    }
  })

  it('POSITIVE CONTROL: it does arm on exactly "true", so the switch is not stuck off', () => {
    process.env[ARM] = 'true'
    expect(emailArmed()).toBe(true)
  })

  it('refuses to deliver while disarmed, and SAYS it refused rather than reporting success', async () => {
    process.env[KEY] = 'test-key-not-a-real-credential'
    delete process.env[ARM]
    const r = await sendEmail({ to: 'david@reddenda.com', subject: 's', html: 'h', text: 't' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.refusedBy).toBe('disarmed')
    expect(r.ok === false && r.reason).toContain('disarmed')
  })
})

describe('the recipient rules, which outrank any settings file', () => {
  it('blocks david@sminet.org by name', () => {
    const r = recipientAllowed('david@sminet.org')
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('blocked')
    expect(BLOCKED_RECIPIENTS).toContain('david@sminet.org')
  })

  it('blocks it whatever the casing or padding', () => {
    for (const v of ['David@SMINet.org', '  david@sminet.org  ', 'DAVID@SMINET.ORG']) {
      expect(recipientAllowed(v).allowed, `${v} must be blocked`).toBe(false)
    }
  })

  it('blocks any address that is not on the allowlist, not just the named one', () => {
    expect(recipientAllowed('someone@example.com').allowed).toBe(false)
    expect(recipientAllowed('').allowed).toBe(false)
  })

  it('POSITIVE CONTROL: allows david@reddenda.com, so the guard is not simply always-on', () => {
    const r = recipientAllowed('david@reddenda.com')
    expect(r.allowed).toBe(true)
    expect(r.reason).toBeNull()
    expect(ALLOWED_RECIPIENTS).toEqual(['david@reddenda.com'])
  })

  it('refuses a blocked recipient at the transport even when armed and configured', async () => {
    process.env[KEY] = 'test-key-not-a-real-credential'
    process.env[ARM] = 'true'
    const r = await sendEmail({ to: 'david@sminet.org', subject: 's', html: 'h', text: 't' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.refusedBy).toBe('recipient')
    // and it must say nothing was sent, in words, not just by returning false
    expect(r.ok === false && r.reason).toContain('Nothing was sent')
  })
})

describe('preflight tells a surface the truth before anybody clicks', () => {
  it('reports not-configured when there is no key', () => {
    delete process.env[KEY]
    expect(sendPreflight('david@reddenda.com').wouldSend).toBe(false)
  })

  it('reports disarmed when configured but not armed', () => {
    process.env[KEY] = 'test-key-not-a-real-credential'
    delete process.env[ARM]
    const p = sendPreflight('david@reddenda.com')
    expect(p.wouldSend).toBe(false)
    expect(p.reason).toContain('disarmed')
  })

  it('reports the recipient reason when armed but the address is wrong', () => {
    process.env[KEY] = 'test-key-not-a-real-credential'
    process.env[ARM] = 'true'
    expect(sendPreflight('david@sminet.org').wouldSend).toBe(false)
  })

  it('POSITIVE CONTROL: reports it WOULD send when everything is right', () => {
    process.env[KEY] = 'test-key-not-a-real-credential'
    process.env[ARM] = 'true'
    const p = sendPreflight('david@reddenda.com')
    expect(p.wouldSend).toBe(true)
    expect(p.reason).toBeNull()
  })
})
