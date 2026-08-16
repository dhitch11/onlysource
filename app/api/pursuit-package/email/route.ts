import { NextRequest } from 'next/server'
import { gateOrJson } from '@/lib/session/require-gate'
import { MODEL_CHAINS } from '@/lib/ai/anthropic'
import { groundBrief } from '@/lib/ai/grounding'
import { assemblePursuitPackage } from '@/lib/intelligence/brief/assemble-package'
import { packageMarkdown } from '@/lib/intelligence/brief/package'
import { emailConfigured, sendEmail } from '@/lib/notify/email'
import { readSettings } from '@/lib/notify/settings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * EMAIL ME THIS PACKAGE — delivery to the OPERATOR, and only the operator.
 *
 * Takes the memo the operator is already reading (no regeneration, so nothing is billed
 * twice and the mail can never differ from the screen), rebuilds the deterministic package
 * server-side, and re-runs the grounding guard on the memo against that fresh package before
 * anything is composed: even a tampered request cannot smuggle an unmeasured number into an
 * email. Delivery rides the disarmed-by-default transport with its recipient allowlist, and
 * a refusal is reported as exactly what it is: not sent, and here is why. Single-operator
 * law: this endpoint cannot address a third party, because the transport's allowlist is the
 * operator's own address.
 */

const KNOWN_MODELS = new Set<string>(Object.values(MODEL_CHAINS).flat())

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function POST(req: NextRequest) {
  const denied = await gateOrJson()
  if (denied) return denied

  // No key at all is an environment fact, stated up front like the alerts route states it:
  // not a send failure, and never a pretend success.
  if (!emailConfigured()) {
    return Response.json(
      { ok: true, sent: false, reason: 'Email is not configured in this environment, so nothing was sent.', refusedBy: 'unconfigured' },
      { status: 200 },
    )
  }

  let body: { nsn?: unknown; memo?: unknown; model?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'bad_request', message: 'Expected a JSON body.' }, { status: 400 })
  }
  const nsnRaw = typeof body.nsn === 'string' ? body.nsn : ''
  const memoRaw = typeof body.memo === 'string' ? body.memo.trim() : ''
  const model = typeof body.model === 'string' ? body.model : ''
  if (!memoRaw) {
    return Response.json(
      { error: 'no_memo', message: 'Generate the package first; there is no memo to send.' },
      { status: 400 },
    )
  }
  // The label must be a model this build can actually have served. Labelling output with a
  // model that did not write it is its own small fabrication.
  if (!KNOWN_MODELS.has(model)) {
    return Response.json(
      { error: 'bad_model', message: 'The memo label does not name a model this build serves.' },
      { status: 400 },
    )
  }

  const assembled = assemblePursuitPackage(nsnRaw)
  if (!assembled.ok) {
    return Response.json({ error: assembled.error, message: assembled.message }, { status: assembled.status })
  }
  const pkg = assembled.pkg

  // The guard runs HERE too. What leaves by email obeys the same law as what renders.
  const grounded = groundBrief(memoRaw, pkg)

  const md = packageMarkdown(pkg, grounded.text, model)
  const subject = `Pursuit package · ${pkg.nsn} · ${pkg.item.slice(0, 60)}`
  const html =
    `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.5; white-space: pre-wrap;">` +
    `${escapeHtml(md)}</pre>`

  const to = readSettings().emailRecipient
  const result = await sendEmail({ to, subject, html, text: md })
  if (!result.ok) {
    /*
     * AN INTENTIONAL REFUSAL IS NOT AN OUTAGE. A disarmed transport or an off-list recipient
     * is this deployment doing what it is configured to do, so it answers 200 with
     * sent:false and the stated reason, never a fake success and never a 5xx that would
     * page somebody about policy.
     */
    if (result.refusedBy) {
      return Response.json({ ok: true, sent: false, reason: result.reason, refusedBy: result.refusedBy })
    }
    return Response.json({ error: 'send_failed', message: result.reason }, { status: 502 })
  }
  return Response.json({ ok: true, sent: true, to })
}
