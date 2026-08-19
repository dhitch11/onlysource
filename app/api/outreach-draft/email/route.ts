import { NextRequest } from 'next/server'
import { callerCan, readCaller, requirePermission } from '@/lib/session/authz'
import { MODEL_CHAINS } from '@/lib/ai/anthropic'
import { groundBrief } from '@/lib/ai/grounding'
import { buildOutreachDossier } from '@/lib/intelligence/suppliers/outreach-dossier'
import { emailConfigured, sendEmail } from '@/lib/notify/email'
import { readSettings } from '@/lib/notify/settings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * EMAIL ME THIS DRAFT — to the OPERATOR's own inbox, never to the supplier.
 *
 * The operator forwards or copies from there; the send to a third party is theirs alone.
 * Structurally enforced, not requested: the transport's recipient allowlist is the
 * operator's address, so this endpoint cannot address a supplier even if asked to. The draft
 * is re-grounded against a freshly built dossier before composition, and a disarmed
 * transport reports "not sent, and here is why" rather than a fake success.
 */

const KNOWN_MODELS = new Set<string>(Object.values(MODEL_CHAINS).flat())

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function POST(req: NextRequest) {
  // Outreach is addressed to a supplier, and this one actually leaves the building.
  const denied = await requirePermission('supplier.pursue')
  if (denied) return denied

  // No key at all is an environment fact, stated up front: not a failure, never a pretend send.
  if (!emailConfigured()) {
    return Response.json(
      { ok: true, sent: false, reason: 'Email is not configured in this environment, so nothing was sent.', refusedBy: 'unconfigured' },
      { status: 200 },
    )
  }

  let body: { nsn?: unknown; draft?: unknown; model?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'bad_request', message: 'Expected a JSON body.' }, { status: 400 })
  }
  const draftRaw = typeof body.draft === 'string' ? body.draft.trim() : ''
  const model = typeof body.model === 'string' ? body.model : ''
  if (!draftRaw) {
    return Response.json(
      { error: 'no_draft', message: 'Generate the draft first; there is nothing to send.' },
      { status: 400 },
    )
  }
  if (!KNOWN_MODELS.has(model)) {
    return Response.json(
      { error: 'bad_model', message: 'The draft label does not name a model this build serves.' },
      { status: 400 },
    )
  }

  const mayReadIdentities = callerCan(await readCaller(), 'supplier.identity.view')
  const built = buildOutreachDossier(typeof body.nsn === 'string' ? body.nsn : '', mayReadIdentities)
  if (!built.ok) {
    return Response.json({ error: built.error, message: built.message }, { status: built.status })
  }
  const dossier = built.dossier
  const grounded = groundBrief(draftRaw, dossier)

  const to = readSettings().emailRecipient
  /*
   * ★ THREE STATES, NOT TWO. "we have no address" and "you may not see the address" are different
   * facts, and the original sentence said the first about both. An operator told no email is on
   * file goes looking for one that is already there.
   */
  const targetLine = !mayReadIdentities
    ? 'The recipient address is withheld: your role does not include seeing supplier identities. An owner can grant it.'
    : dossier.target.book?.email
      ? `Send it yourself to: ${dossier.target.book.person ? `${dossier.target.book.person}, ` : ''}${dossier.target.book.email}`
      : 'No email is on file for the target holder; the Suppliers book carries what is known.'
  const text = [
    `Supplier outreach draft for NSN ${dossier.nsn}${dossier.item ? ` (${dossier.item})` : ''}.`,
    targetLine,
    '',
    grounded.text,
    '',
    `Written by ${model} from the measured outreach dossier. This was delivered to you only; nothing was sent to the supplier.`,
  ].join('\n')

  const result = await sendEmail({
    to,
    subject: `Outreach draft · NSN ${dossier.nsn}`,
    html: `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(text)}</pre>`,
    text,
  })
  if (!result.ok) {
    if (result.refusedBy) {
      return Response.json({ ok: true, sent: false, reason: result.reason, refusedBy: result.refusedBy })
    }
    return Response.json({ error: 'send_failed', message: result.reason }, { status: 502 })
  }
  return Response.json({ ok: true, sent: true, to })
}
