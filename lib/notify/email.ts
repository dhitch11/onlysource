/**
 * EMAIL TRANSPORT — the alert channel that reaches the operator when they are not looking at the app.
 *
 * A thin fetch wrapper over Resend, mirroring the AI client: the key is read from the environment at
 * call time and never appears in the repository. It fails CLOSED and LOUD: no key returns a stated
 * "not configured" rather than a silent success, so an alert can never be quietly dropped. The caller
 * owns the recipient (from settings) and the content (from the signal engine); this only delivers.
 */
const ENDPOINT = 'https://api.resend.com/emails'

export type EmailResult = { ok: true; id: string } | { ok: false; reason: string; configured: boolean }

export function emailConfigured(): boolean {
  return Boolean(process.env.ONLYSOURCE_RESEND_KEY)
}

/** The verified sender. ONLYSOURCE alerts go out over the estate's verified reddenda.com domain. */
export const ALERT_FROM = process.env.ONLYSOURCE_ALERT_FROM || 'ONLYSOURCE Signals <info@reddenda.com>'

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<EmailResult> {
  const key = process.env.ONLYSOURCE_RESEND_KEY
  if (!key) return { ok: false, reason: 'Email is not configured in this environment.', configured: false }
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
