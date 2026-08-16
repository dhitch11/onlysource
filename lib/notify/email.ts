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
 *   2. THE RECIPIENT ALLOWLIST. Only addresses on the allowlist can be delivered to, whatever the
 *      settings file or the request body says. It defaults to david@reddenda.com and is set by
 *      ONLYSOURCE_ALLOWED_RECIPIENTS, so WHO receives mail is configuration, not source code.
 *
 * ★ A CORRECTION, KEPT BECAUSE THE MISTAKE IS THE USEFUL PART. This module briefly carried a
 *   hardcoded BLOCKLIST naming david@sminet.org, added because the owner said not to send him
 *   updates. He corrected it: "SMI Net should not be on a block list. I just said don't send him
 *   updates or emails until I tell you to."
 *
 *   That is the difference between a POLICY and a TIMING decision, and I encoded the wrong one. A
 *   blocklist says "never, by nature". He said "not yet". Burning a temporary instruction into
 *   source makes it permanent, invisible and hard to reverse: months later somebody finds an
 *   address branded as blocked with no idea the reason expired. The arm switch already expresses
 *   "nothing goes out until I say so", which is what he actually asked for, and the allowlist
 *   expresses who is in scope when it does. Neither needs a name compiled in.
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

/**
 * Who may receive mail from this deployment. Configuration, not source code.
 *
 * Defaults to the owner's stated recipient for platform updates. Widening it is an environment
 * change on the server, which is a deliberate act somebody can see and undo, rather than a code
 * change that has to be found, understood and reverted.
 */
export function allowedRecipients(): string[] {
  const configured = (process.env.ONLYSOURCE_ALLOWED_RECIPIENTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return configured.length > 0 ? configured : ['david@reddenda.com']
}

/** Kept as a named export for callers that render the current policy. */
export const DEFAULT_RECIPIENT = 'david@reddenda.com'

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
  const allowed = allowedRecipients()
  if (!allowed.includes(addr)) {
    return {
      allowed: false,
      // Says WHO is currently in scope and that the list is settable, so a reader knows this is a
      // current configuration rather than a judgement about the address.
      reason: `${addr} is not on this deployment's recipient list, which is currently ${allowed.join(', ')}. Set ONLYSOURCE_ALLOWED_RECIPIENTS on the server to change it.`,
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
