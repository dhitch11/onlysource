import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ALERT_FROM,
  DEFAULT_RECIPIENT,
  allowedRecipients,
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
 * any emails. Everything should get ready to be able to send them."
 *
 * TWO CONTROLS, AND THEY ANSWER DIFFERENT QUESTIONS:
 *   the ARM SWITCH answers "is this deployment sending at all right now" (it is not), and
 *   the RECIPIENT LIST answers "who is in scope when it does" (david@reddenda.com by default).
 *
 * Neither names an address as permanently unwelcome. An earlier version of this file did, and the
 * owner corrected it. Encoding a "not yet" as a "never" hides a reversible decision inside a build.
 *
 * Every refusal below is paired with a POSITIVE CONTROL proving the same function ALLOWS the
 * correct case, so a module that refused everything would fail here rather than pass.
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

describe('the recipient list is configuration, not a name compiled into the source', () => {
  /*
   * This block replaced a hardcoded BLOCKLIST that named one address. The owner corrected it:
   * "SMI Net should not be on a block list. I just said don't send him updates or emails until I
   * tell you to." A blocklist encodes "never, by nature"; he expressed "not yet". The arm switch
   * already carries "not yet", and WHO is in scope is now an environment setting somebody can see
   * and change, rather than a judgement about an address baked into a build.
   */
  const LIST = 'ONLYSOURCE_ALLOWED_RECIPIENTS'
  let prevList: string | undefined

  beforeEach(() => {
    prevList = process.env[LIST]
  })
  afterEach(() => {
    if (prevList === undefined) delete process.env[LIST]
    else process.env[LIST] = prevList
  })

  it('defaults to the owner address when nothing is configured', () => {
    delete process.env[LIST]
    expect(allowedRecipients()).toEqual([DEFAULT_RECIPIENT])
    expect(recipientAllowed(DEFAULT_RECIPIENT).allowed).toBe(true)
  })

  it('refuses an address that is not in scope, and says the list is settable', () => {
    delete process.env[LIST]
    const r = recipientAllowed('someone@example.com')
    expect(r.allowed).toBe(false)
    // The refusal must read as "not currently in scope", never as a verdict about the person.
    expect(r.reason).toContain('recipient list')
    expect(r.reason).toContain('ONLYSOURCE_ALLOWED_RECIPIENTS')
    expect(r.reason).not.toMatch(/blocked|banned|forbidden/i)
  })

  it('NO ADDRESS IS PERMANENTLY BLOCKED: any address becomes allowed when configured', () => {
    // The regression guard for the correction. If somebody reintroduces a blocklist, this fails.
    process.env[LIST] = 'david@sminet.org, david@reddenda.com'
    expect(recipientAllowed('david@sminet.org').allowed).toBe(true)
    expect(recipientAllowed('david@reddenda.com').allowed).toBe(true)
    expect(recipientAllowed('nobody@example.com').allowed).toBe(false)
  })

  it('matches case-insensitively and ignores padding', () => {
    process.env[LIST] = 'David@Reddenda.com'
    expect(recipientAllowed('  DAVID@REDDENDA.COM  ').allowed).toBe(true)
  })

  it('an empty recipient is refused', () => {
    expect(recipientAllowed('').allowed).toBe(false)
  })

  it('the arm switch still stops delivery to an ALLOWED address, so scope is not permission', async () => {
    process.env[KEY] = 'test-key-not-a-real-credential'
    delete process.env[ARM]
    const r = await sendEmail({ to: DEFAULT_RECIPIENT, subject: 's', html: 'h', text: 't' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.refusedBy).toBe('disarmed')
  })

  it('refuses an out-of-scope recipient at the transport even when armed', async () => {
    process.env[KEY] = 'test-key-not-a-real-credential'
    process.env[ARM] = 'true'
    delete process.env[LIST]
    const r = await sendEmail({ to: 'someone@example.com', subject: 's', html: 'h', text: 't' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.refusedBy).toBe('recipient')
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
