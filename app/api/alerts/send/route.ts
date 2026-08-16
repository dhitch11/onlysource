import { NextRequest } from 'next/server'
import { readGateVerdict } from '@/lib/session/require-gate'
import { computeSignals } from '@/lib/notify/signals'
import { readSettings, channelEnabled } from '@/lib/notify/settings'
import { sendEmail, emailConfigured } from '@/lib/notify/email'
import { digestHtml, digestText, digestSubject } from '@/lib/notify/digest'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * SEND THE ALERT DIGEST. Two callers, one path:
 *   - the scheduler on the box, carrying the shared ALERT_CRON_TOKEN (machine, no session)
 *   - the operator pressing "Send me a test" in Settings (a valid gate session)
 * Anything else is refused. It gathers the email-enabled signals, builds the digest, and delivers to
 * the recipient in settings. It never bills or claims a send it did not make: a Resend failure comes
 * back as an honest error, and no-signals is a stated no-op, not a silent success.
 *
 * ?test=1 addresses the digest to a test recipient (settings.emailRecipient is the real one), so a
 * test never has to reach the live inbox.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('x-alert-token')
  const cronOk = Boolean(process.env.ALERT_CRON_TOKEN) && token === process.env.ALERT_CRON_TOKEN
  const sessionOk = cronOk ? false : (await readGateVerdict()).valid
  if (!cronOk && !sessionOk) {
    return Response.json({ error: 'not_authorised' }, { status: 401 })
  }

  if (!emailConfigured()) {
    return Response.json({ error: 'email_unconfigured', message: 'Alert email is not connected in this environment.' }, { status: 503 })
  }

  const set = computeSignals()
  if (!set.present) {
    return Response.json({ error: 'no_data', message: 'No feed loaded, so there is nothing to alert on.' }, { status: 503 })
  }
  const settings = readSettings()
  const signals = set.signals.filter((s) => channelEnabled(settings, s.kind, 'email'))
  if (signals.length === 0) {
    return Response.json({ ok: true, sent: false, reason: 'No email-enabled signals right now.' })
  }

  const url = new URL(req.url)
  const isTest = url.searchParams.get('test') === '1'
  const to = isTest ? process.env.ONLYSOURCE_TEST_RECIPIENT || settings.emailRecipient : settings.emailRecipient
  const subject = (isTest ? '[test] ' : '') + digestSubject(signals, set.feedDay)

  const result = await sendEmail({ to, subject, html: digestHtml(signals, set.feedDay), text: digestText(signals, set.feedDay) })
  if (!result.ok) {
    /*
     * AN INTENTIONAL REFUSAL IS NOT AN OUTAGE. While the deployment is deliberately disarmed
     * (or a recipient is outside the configured allowlist), "nothing was sent" is this
     * endpoint doing exactly what it is configured to do, so it answers 200 with sent:false
     * and the stated reason. 5xx is reserved for a genuine delivery failure, so the day a
     * real outage happens it is distinguishable from policy instead of byte-identical to it.
     * `reason` carries the same human sentence the interface already shows.
     */
    if (result.refusedBy) {
      return Response.json({ ok: true, sent: false, reason: result.reason, refusedBy: result.refusedBy })
    }
    return Response.json({ error: 'send_failed', message: result.reason }, { status: 502 })
  }
  return Response.json({ ok: true, sent: true, to, count: signals.length, id: result.id })
}
