/**
 * EMAIL TRANSPORT — the alert channel that reaches the operator when they are not looking at the app.
 *
 * A thin fetch wrapper over Resend, mirroring the AI client: the key is read from the environment at
 * call time and never appears in the repository. It fails CLOSED and LOUD: no key returns a stated
 * "not configured" rather than a silent success, so an alert can never be quietly dropped. The caller
 * owns the recipient (from settings) and the content (from the signal engine); this only delivers.
 *
 * ==========================================================================================
 * OWNER RULING 2026-08-16: THE CAPABILITY IS BUILT, THE SENDING IS OFF.
 * ==========================================================================================
 * Verbatim: "That shouldn't be happening unless it was just a test, but definitely should not be
 * sending any emails. Everything should get ready to be able to send them."
 *
 * So this module keeps every path complete and testable, and refuses to deliver unless sending is
 * explicitly ARMED. Three controls, and they are deliberately independent because a single switch
 * is a single point of failure:
 *
 *   1. THE ARM SWITCH. `ONLYSOURCE_EMAIL_ARMED` must be exactly "true". Absent means DISARMED, so
 *      a fresh environment, a restored backup and a new server are all silent by default. Nothing
 *      is sent by accident because somebody forgot to set a variable.
 *   2. THE RECIPIENT ALLOWLIST. Only addresses in ALLOWED_RECIPIENTS can be delivered to, whatever
 *      the settings file, the request body or the environment says. Platform updates go to
 *      david@reddenda.com and nowhere else.
 *   3. THE BLOCKLIST, which outranks everything. david@sminet.org is refused by name. It was the
 *      configured test recipient and the owner ruled it must not receive platform updates. A rule
 *      that matters is a rule that is enforced in code, not a value in a settings file that the
 *      next lane edits without knowing why it was set.
 *
 * A refusal is REPORTED, never silently swallowed: the caller gets `{ok:false, reason}` naming which
 * control refused, so the interface can say "not sent, and here is why" rather than showing a
 * cheerful success on a message that never left.
 */
const ENDPOINT = 'https://api.resend.com/emails'

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; configured: boolean; refusedBy?: 'disarmed' | 'recipient' }

export function emailConfigured(): boolean {
  return Boolean(process.env.ONLYSOURCE_RESEND_KEY)
}

/**
 * The verified sender. Owner ruling 2026-08-16: "Any emails should come from david@reddenda.org
 * for now." Overridable by environment for the day that changes, defaulting to the ruling rather
 * than to the old info@reddenda.com so an unset variable lands on the correct address.
 */
export const ALERT_FROM = process.env.ONLYSOURCE_ALERT_FROM || 'ONLYSOURCE <david@reddenda.org>'

/** Platform updates go here and nowhere else, by owner ruling. */
export const ALLOWED_RECIPIENTS: readonly string[] = ['david@reddenda.com']

/** Refused by name, outranking every other control. */
export const BLOCKED_RECIPIENTS: readonly string[] = ['david@sminet.org']

/** Sending is off unless explicitly armed. Absent, empty or anything but "true" means DISARMED. */
export function emailArmed(): boolean {
  return process.env.ONLYSOURCE_EMAIL_ARMED === 'true'
}

/**
 * May this address be delivered to? Exported so the interface can show the state BEFORE a click,
 * and so the same rule is testable without sending anything.
 */
export function recipientAllowed(to: string): { allowed: boolean; reason: string | null } {
  const addr = to.trim().toLowerCase()
  if (!addr) return { allowed: false, reason: 'No recipient was given.' }
  if (BLOCKED_RECIPIENTS.includes(addr)) {
    return {
      allowed: false,
      reason: `${addr} is blocked from receiving platform updates. Updates go to ${ALLOWED_RECIPIENTS.join(', ')}.`,
    }
  }
  if (!ALLOWED_RECIPIENTS.includes(addr)) {
    return {
      allowed: false,
      reason: `${addr} is not on the allowed recipient list. Updates go to ${ALLOWED_RECIPIENTS.join(', ')}.`,
    }
  }
  return { allowed: true, reason: null }
}

/**
 * Would this send go out right now, and if not, why? Pure, so a surface can render the honest
 * state of the channel without attempting a delivery to find out.
 */
export function sendPreflight(to: string): { wouldSend: boolean; reason: string | null } {
  if (!emailConfigured()) return { wouldSend: false, reason: 'Email is not configured in this environment.' }
  if (!emailArmed()) {
    return {
      wouldSend: false,
      reason:
        'Email sending is disarmed. The channel is built and tested; delivery stays off until it is armed on the server.',
    }
  }
  const r = recipientAllowed(to)
  return r.allowed ? { wouldSend: true, reason: null } : { wouldSend: false, reason: r.reason }
}

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<EmailResult> {
  const key = process.env.ONLYSOURCE_RESEND_KEY
  if (!key) return { ok: false, reason: 'Email is not configured in this environment.', configured: false }

  // ---- control 1: the arm switch, checked before anything is composed or dispatched ----
  if (!emailArmed()) {
    return {
      ok: false,
      reason:
        'Email sending is disarmed on this deployment, so nothing was sent. Set ONLYSOURCE_EMAIL_ARMED=true on the server to arm it.',
      configured: true,
      refusedBy: 'disarmed',
    }
  }

  // ---- controls 2 and 3: the recipient rules, enforced here and not in a settings file ----
  const gate = recipientAllowed(opts.to)
  if (!gate.allowed) {
    return { ok: false, reason: `${gate.reason} Nothing was sent.`, configured: true, refusedBy: 'recipient' }
  }

  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: ALERT_FROM, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      return { ok: false, reason: `Resend returned ${resp.status}. ${detail.slice(0, 160)}`, configured: true }
    }
    const data = (await resp.json()) as { id?: string }
    return { ok: true, id: data.id ?? 'sent' }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 160) : 'Email send errored.', configured: true }
  }
}
