import { NextRequest } from 'next/server'
import { requirePermission, callerCan, readCaller } from '@/lib/session/authz'
import { generate, aiConfigured } from '@/lib/ai/anthropic'
import { groundBrief } from '@/lib/ai/grounding'
import { assemblePursuitPackage } from '@/lib/intelligence/brief/assemble-package'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * THE PURSUIT PACKAGE MEMO — the flagship deliverable.
 *
 * One press turns a cornered stock number into a deal memo a person could hand to a partner:
 * the corner case with its evidence states, the modeled economics WITH THEIR BASIS, who
 * holds or made the article (joined to the researched supplier book), the named gaps, and
 * the honest next steps. The engine assembles every fact; the model writes only the
 * sentences, on the DELIVERABLE slot (Opus 5 first, per the owner's ruling), and the
 * response names the model that actually served it.
 *
 * The grounding guard runs on the output: any sentence carrying a number the package does
 * not contain is stripped and reported, so "no number appears that this build did not
 * measure" is enforced, not requested. A failed generation is a JSON error and is never
 * billed as a memo.
 */
export async function POST(req: NextRequest) {
  // A pursuit package is the quoting decision, assembled.
  const denied = await requirePermission('board.quote')
  if (denied) return denied

  /*
   * `board.quote` says this caller may assemble a quoting decision. It says nothing about whether
   * they may see WHO the suppliers are — that is `supplier.identity.view`, which is
   * `sensitive: true` and which `read_only` deliberately does not hold. The package is resolved
   * WITHOUT the identities rather than resolved and then stripped, because this object is fed to a
   * language model and anything still in memory at prose time gets spoken.
   */
  const mayReadIdentities = callerCan(await readCaller(), 'supplier.identity.view')

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
  const nsnRaw = typeof body.nsn === 'string' ? body.nsn : ''

  const assembled = assemblePursuitPackage(nsnRaw, mayReadIdentities)
  if (!assembled.ok) {
    return Response.json({ error: assembled.error, message: assembled.message }, { status: assembled.status })
  }
  const pkg = assembled.pkg

  /*
   * 2600 tokens is HEADROOM, not a target: the prompt caps the memo at ~420 words and a
   * measured generation ran ~600 tokens of text. The first cap (1600) clipped a real Opus 5
   * memo mid-word once the model spent tokens quoting identifiers, and a deliverable with a
   * cut tail is a defect. The cap exists only so a runaway generation cannot bill forever.
   */
  const result = await generate(SYSTEM_PROMPT, renderPackage(pkg), 2600, 'deliverable')
  if (!result.ok) {
    log.warn('pursuit_package.ai_failed', { nsn: pkg.nsn, tried: result.triedModels.join(',') })
    return Response.json({ error: 'ai_failed', message: result.reason }, { status: 502 })
  }

  const grounded = groundBrief(result.text, pkg)
  if (grounded.stripped.length > 0) {
    log.warn('pursuit_package.grounding.stripped', { nsn: pkg.nsn, count: grounded.stripped.length })
  }

  return Response.json({
    nsn: pkg.nsn,
    memo: grounded.text,
    package: pkg,
    unverified: grounded.stripped,
    model: result.model,
  })
}

const SYSTEM_PROMPT = `You are the analyst inside ONLYSOURCE, a defense-parts opportunity-intelligence platform. You are writing the PURSUIT PACKAGE MEMO: a premium, disciplined deal memo for an operator who is about to spend real hours and real money pursuing one cornered stock number, and who may show this memo to a partner.

Your ONLY source of fact is the PACKAGE supplied in the user message. Absolute rules:

- Never state a number, price, date, quantity, percentage, company, or person that is not in the package. Do not estimate, extrapolate, or infer a market size. Do not compute new figures: no multiplying, summing, or averaging. The modeled buy value and its basis are already computed in the package; quote them as given, with their qualifier (modeled, not a quote).
- Write stock numbers exactly as the package carries them: contiguous digits, no hyphens.
- Availability is "listed" or "self-reported", never "confirmed" or "in stock". Award silence is a signal, not proof the incumbent is gone; say "award-silent", never "abandoned".
- The score is an ordinal watchlist rank, not a probability or a dollar.
- Where the package names a gap, name it. A gap is part of the memo, not a blemish to smooth over.
- The dossier's source.crossReference block, where present, is the RESOLVED read of the approved-source counters (rows versus distinct companies). State the resolved picture; do not report the raw counts as a conflict.
- Quotes are filed on DIBBS by the operator, by hand. Never imply this product submits anything to a government system.
- No hype, no guarantees. No em dashes.

Structure the memo in five short labeled parts, plain text (no markdown headers, short ALL-CAPS labels on their own line):
THE OPPORTUNITY  what the part is, who is approved to make it, why it is a corner, and the live requirement if one is open.
THE ECONOMICS  the modeled buy value with its stated basis, the price history anchor, and the escalation, quoting only the package's figures. If a leg is unread, say so.
THE SUPPLY  who lists stock, who is approved, who made it before, and which of them the supplier book can actually reach (names and channels only as given). Listed is not confirmed.
RISKS AND GAPS  the package's named gaps, verbatim in spirit.
THE PLAN  the package's next steps, tightened into prose. The operator files on DIBBS themselves.

Keep it under 600 words. Every sentence must be defensible from the package alone.`

function renderPackage(pkg: unknown): string {
  return `PURSUIT PACKAGE\n\n${JSON.stringify(pkg, null, 2)}`
}
