import { gateOrJson } from '@/lib/session/require-gate'
import { resolveDataRoot } from '@/lib/data-root'
import { buildPortfolio, buildPortfolioDossier } from '@/lib/intelligence/portfolio'
import { generate, aiConfigured } from '@/lib/ai/anthropic'
import { groundBrief } from '@/lib/ai/grounding'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * THE PORTFOLIO BRIEF — "today's top plays" across the whole candidate book.
 *
 * Same contract as the per-corner brief: Claude is handed a dossier of measured aggregates and the
 * top-ranked corners, and writes a strategic read from that alone. It names real stock numbers and
 * real figures or it abstains. Gated, and it never bills a generation it did not return.
 */
export async function POST() {
  const denied = await gateOrJson()
  if (denied) return denied

  if (!aiConfigured()) {
    return Response.json(
      { error: 'ai_unconfigured', message: 'The analyst is not connected in this environment.' },
      { status: 503 },
    )
  }
  if (!resolveDataRoot().present) {
    return Response.json(
      { error: 'no_data', message: 'The data directory is not mounted here.' },
      { status: 503 },
    )
  }

  const pf = buildPortfolio()
  if (!pf.ok) {
    return Response.json(
      { error: 'empty', message: 'No candidate corners in this feed day to brief.' },
      { status: 404 },
    )
  }
  const dossier = buildPortfolioDossier(pf)
  /*
   * 2600 tokens is HEADROOM, not a target: the prompt caps the brief at ~300 words. The old
   * 1200 cap served two independent live generations truncated MID-WORD as successes
   * ("…availability are un", "…remain at INSUFFICIEN"), because this number-dense output
   * tokenizes far past its word count. Same lesson the pursuit-package route already carries:
   * the cap exists so a runaway generation cannot bill forever, never as the editor. The
   * client also refuses to serve any stop_reason=max_tokens response (lib/ai/anthropic.ts).
   */
  const result = await generate(SYSTEM_PROMPT, `PORTFOLIO DOSSIER\n\n${JSON.stringify(dossier, null, 2)}`, 2600, 'portfolio_brief')
  if (!result.ok) {
    return Response.json({ error: 'ai_failed', message: result.reason }, { status: 502 })
  }
  // Enforce the measured-only promise: strip any sentence with a number not in the portfolio dossier.
  const grounded = groundBrief(result.text, dossier)
  return Response.json({ brief: grounded.text, unverified: grounded.stripped, model: result.model })
}

const SYSTEM_PROMPT = `You are the lead analyst inside ONLYSOURCE, a defense-parts opportunity-intelligence platform. You are briefing an operator on the whole candidate book for one feed day: cornered DLA stock numbers (one approved maker, the government still buying, that maker gone award-silent).

Your ONLY source of fact is the PORTFOLIO DOSSIER supplied. Absolute rules:
- Never state a number, price, percentage, stock number, or company that is not in the dossier. Do not estimate, sum, average, project a market size, or compute a new figure. Quote the dossier's values exactly.
- CornerScore is an ordinal watchlist rank, not a probability or a dollar. Never turn it into odds or money.
- "Award-silent" is a signal, not proof a maker is gone. Never say "abandoned."
- No hype, no guarantees. A disciplined read for a professional. No em dashes.

Write in three short labeled parts, plain text (short ALL-CAPS labels on their own line):
THE SHAPE OF THE BOOK — what this feed day's candidate book looks like: how many corners, where the demand concentrates (supply chains), the disposition and award-path mix. Cite the counts.
THE TOP PLAYS — name the 3 to 5 strongest specific corners by stock number and item, each with its one-line reason from the dossier (price, escalation, forecast, machine-award, score). Only what the dossier gives.
WHERE TO PUSH — the honest strategic read: which cluster to work first and why, and the gate the whole book still has to clear (feasibility and availability are unread across the board).

Keep it under 300 words. Every sentence must be defensible from the dossier alone.`
