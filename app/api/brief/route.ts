import { NextRequest } from 'next/server'
import { gateOrJson } from '@/lib/session/require-gate'
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'
import { generate, aiConfigured } from '@/lib/ai/anthropic'
import { buildCornerDossier, type CornerDossier } from '@/lib/intelligence/brief/dossier'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * THE AI OPPORTUNITY BRIEF.
 *
 * A plain-English read of ONE cornered stock number, written by Claude from a dossier this build
 * measured. The endpoint owns the facts; the model owns only the sentences. It is handed a dossier
 * of real numbers — award history, prices, the awardee, forecast demand, the score legs and their
 * evidence states, the named gaps — and is told, in the system prompt, that it may not add a figure,
 * a date, a price, or a claim that is not in that dossier. A corner with a gap must have the gap
 * named, not filled. That is the same contract the rest of the product runs on, applied to prose.
 *
 * Gated (a brief reads the real book of business), Node runtime (it reads the data files), and it
 * never bills a generation it did not return: a failure is a JSON error, not a half-written brief.
 */
export async function POST(req: NextRequest) {
  const denied = await gateOrJson()
  if (denied) return denied

  if (!aiConfigured()) {
    return Response.json(
      { error: 'ai_unconfigured', message: 'The analyst is not connected in this environment.' },
      { status: 503 },
    )
  }

  const root = resolveDataRoot()
  if (!root.present) {
    return Response.json(
      { error: 'no_data', message: 'The data directory is not mounted here.' },
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
  const key = nsnRaw.replace(/[^0-9]/g, '')
  if (key.length < 9) {
    return Response.json({ error: 'bad_nsn', message: 'A stock number is required.' }, { status: 400 })
  }

  // Find the corner and assemble its dossier from the same computation the Monopoly Map uses.
  const { cornerMap } = buildAllDatasets()
  const row = cornerMap.rows.find((r) => r.nsn.replace(/[^0-9]/g, '') === key)
  if (!row) {
    return Response.json(
      { error: 'not_found', message: 'That stock number is not in this feed day.' },
      { status: 404 },
    )
  }
  const awardIx = buildNsnAwardIndex()
  const fcIx = buildForecastIndex()
  const award = awardIx.ok ? awardIx.byNsn.get(key) ?? null : null
  const forecast = fcIx.ok ? fcIx.byNsn.get(key) ?? null : null
  const score = scoreCorner(row, award, forecast)

  const dossier: CornerDossier = buildCornerDossier(row, award, forecast, score)

  const result = await generate(SYSTEM_PROMPT, renderDossier(dossier), 1100)
  if (!result.ok) {
    return Response.json({ error: 'ai_failed', message: result.reason }, { status: 502 })
  }

  return Response.json({ nsn: row.nsn, brief: result.text, dossier })
}

const SYSTEM_PROMPT = `You are the analyst inside ONLYSOURCE, a defense-parts opportunity-intelligence platform that finds cornered DLA/DIBBS stock numbers: parts one approved company may make, that the government keeps buying, where that company has gone quiet on awards.

You write a short, sharp opportunity brief for an operator who is deciding whether to pursue this corner. Your ONLY source of fact is the DOSSIER supplied in the user message. Absolute rules:

- Never state a number, price, date, quantity, percentage, or company that is not in the dossier. Do not estimate, round to a "nice" figure, extrapolate a trend beyond the dossier, or infer a market size. If the dossier says a leg is UNAVAILABLE or a gap is open, name it as unknown — do not fill it.
- The score is an ordinal watchlist rank, not a probability or a dollar. Never describe it as odds of winning or as money.
- Award silence is a signal, not proof the incumbent is gone; federal reporting is not required below the micro-purchase threshold. Say "award-silent," never "abandoned."
- No hype, no guarantees, no "you will win." This is a disciplined read for a professional. No em dashes.

Structure the brief in four short labeled parts, plain text (no markdown headers, use short ALL-CAPS labels on their own line):
THE CORNER — one or two sentences: what the part is, who holds it, why it is a corner.
THE MONEY — the real price history and forward demand, quoting only the dossier's figures. If price or demand is unknown, say so.
THE PLAY — the concrete next move given the award path and the score, honest about the gate to clear.
WHAT WE DON'T KNOW YET — the open legs and gaps from the dossier, verbatim in spirit.

Keep it under 220 words. Every sentence must be defensible from the dossier alone.`

function renderDossier(d: CornerDossier): string {
  return `DOSSIER for stock number ${d.nsn}\n\n${JSON.stringify(d, null, 2)}`
}
