import { NextRequest } from 'next/server'
import { requirePermission } from '@/lib/session/authz'
import { generate, aiConfigured } from '@/lib/ai/anthropic'
import { groundBrief } from '@/lib/ai/grounding'
import { buildOutreachDossier } from '@/lib/intelligence/suppliers/outreach-dossier'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * THE SUPPLIER OUTREACH DRAFT — buy-side, grounded, and DRAFT-ONLY by law.
 *
 * For a deal whose stock number has listed holders, this writes the email the operator would
 * send to the holder the book can reach: the dormant-inventory offer in the operator's own
 * proven shape (market it back into the supply chain, or buy it outright; the easy ask),
 * personalised with only the facts the dossier holds. The DELIVERABLE slot writes it (Opus 5
 * first), the grounding guard strips anything unmeasured, and the response names the model
 * that actually served it.
 *
 * SINGLE-OPERATOR LAW: nothing here sends. The draft comes back to the operator with a copy
 * control; the only email path is "email me this draft", which delivers to the operator's
 * own allowlisted address through the disarmed-by-default transport.
 */
export async function POST(req: NextRequest) {
  // An outreach draft is addressed to a supplier, so it is pursuit work.
  const denied = await requirePermission('supplier.pursue')
  if (denied) return denied

  if (!aiConfigured()) {
    return Response.json(
      { error: 'ai_unconfigured', message: 'The analyst is not connected in this environment.' },
      { status: 503 },
    )
  }

  let body: { nsn?: unknown }
  try {
    body = (await req.json()) as { nsn?: unknown }
  } catch {
    return Response.json({ error: 'bad_request', message: 'Expected a JSON body.' }, { status: 400 })
  }
  const built = buildOutreachDossier(typeof body.nsn === 'string' ? body.nsn : '')
  if (!built.ok) {
    return Response.json({ error: built.error, message: built.message }, { status: built.status })
  }
  const dossier = built.dossier

  const result = await generate(SYSTEM_PROMPT, `OUTREACH DOSSIER\n\n${JSON.stringify(dossier, null, 2)}`, 700, 'deliverable')
  if (!result.ok) {
    log.warn('outreach_draft.ai_failed', { nsn: dossier.nsn, tried: result.triedModels.join(',') })
    return Response.json({ error: 'ai_failed', message: result.reason }, { status: 502 })
  }

  const grounded = groundBrief(result.text, dossier)
  if (grounded.stripped.length > 0) {
    log.warn('outreach_draft.grounding.stripped', { nsn: dossier.nsn, count: grounded.stripped.length })
  }

  return Response.json({
    nsn: dossier.nsn,
    draft: grounded.text,
    dossier,
    unverified: grounded.stripped,
    model: result.model,
  })
}

const SYSTEM_PROMPT = `You draft a buy-side email for a defense-parts trader. The recipient is a supplier who lists stock for one government stock number. The trader's proven play, which you follow exactly: the supplier's dormant DLA inventory is worth real money, and the trader offers to MARKET it back into the government supply chain or BUY it outright. The ask is easy and the tone is direct and human, one businessperson to another.

Your ONLY source of fact is the OUTREACH DOSSIER in the user message. Absolute rules:

- Never state a number, price, date, quantity, company, or person that is not in the dossier. No estimates, no computed figures, no invented history.
- Greet by first name ONLY if the dossier's target.book.person names the person the email goes to; otherwise greet with no name. Never greet one person while writing to another's address.
- Write stock numbers exactly as the dossier carries them: contiguous digits, no hyphens.
- You may say the government has an open requirement only when liveRequirement is present; quote its quantity only as given. Stock they list is "listed", never "confirmed".
- NEVER quote an award price, an award value, or what the government paid to the recipient. This is buy-side email: handing the seller the last award price hands them the anchor to price against. The open requirement and their own listed quantity are the useful facts; the trader's price knowledge stays theirs.
- Structure: SUBJECT: on the first line, then a blank line, then the body. Under 140 words of body. Short paragraphs.
- The body ends with a one-line easy ask (a quick reply gets it moving) and then exactly "Thanks," on its own line. NOTHING after "Thanks," - no name, no company, no title. The operator signs it themselves.
- No hype, no pressure tactics, no em dashes.`
