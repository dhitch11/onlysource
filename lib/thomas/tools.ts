/**
 * THOMAS'S HANDS.
 *
 * Two kinds of tool, and the split is the whole design.
 *
 * SERVER TOOLS run here, against the same engines the screens use. They exist so that every number
 * Thomas says is a number this build measured seconds ago, rather than something he remembers or
 * infers. This is the mechanism behind "the model explains, it never computes a figure that ships":
 * if he wants to talk about a price, he has to go and get it.
 *
 * CLIENT TOOLS do not run here at all. They are returned to the browser, which executes them: change
 * route, open a dossier, set a filter, point at something. That is what makes Thomas able to drive
 * the platform instead of only describing it. The browser is the only place that CAN do those things,
 * so the server names the intent and the client performs it.
 *
 * A NOTE ON WHY SERVER TOOLS RETURN SHAPED TEXT RATHER THAN RAW JSON. Handing a model a large JSON
 * blob invites it to do arithmetic on the parts, which is exactly the failure this design exists to
 * prevent. So each tool returns the specific figures already computed, already labelled, in the words
 * they should be spoken in. The model is left with nothing to calculate.
 */
import 'server-only'
import { buildAllDatasets, buildNoQuoteGoldmine, buildDistressed } from '@/lib/intelligence/datasets'
import { awardHistoryState, buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'
import { buildCornerDossier } from '@/lib/intelligence/brief/dossier'
import { buildPortfolio } from '@/lib/intelligence/portfolio'
import { resolveDataRoot } from '@/lib/data-root'
import { refuseTool, type ToolAccess, type ToolRefusal } from './authz'
import { can } from '@/lib/admin/permissions'
import type { ToolSpec } from './claude'

/* ------------------------------------------------------------------------------------------- */
/* THE SPECS                                                                                     */
/* ------------------------------------------------------------------------------------------- */

export const SERVER_TOOLS: ToolSpec[] = [
  {
    name: 'lookup_stock_number',
    description:
      'Pull the REAL, current dossier for one NSN (stock number): approved sources, whether the holder is award-silent, the measured price history and escalation, forward demand from the DLA forecast, the CornerScore and each of its evidence-graded legs, and the named gaps. Call this whenever the operator names or implies a specific stock number, or asks anything about a specific part. Never answer about a specific stock number from memory.',
    input_schema: {
      type: 'object',
      properties: {
        nsn: { type: 'string', description: 'The stock number. Any format; punctuation is stripped.' },
      },
      required: ['nsn'],
    },
  },
  {
    name: 'portfolio_snapshot',
    description:
      'Read the CURRENT live totals across the whole candidate book: how many candidate corners, how many on the government forecast, how many priced, how many machine-award eligible, the supply-chain split, and the top corners by CornerScore right now. Call this for any "how many", "what is the state of", "what should I look at today" question, instead of quoting a remembered figure.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'find_opportunities',
    description:
      'Search and rank the live corner map. Use for "show me", "what is the best", "find me corners that ...". Filters AND together. Returns the top matches with their real scores and prices.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text matched against item name and stock number.' },
        on_forecast: { type: 'boolean', description: 'Only corners on the DLA forward forecast.' },
        rising_price: { type: 'boolean', description: 'Only corners whose measured price is rising.' },
        machine_award: { type: 'boolean', description: 'Only machine-award eligible corners.' },
        supply_chain: { type: 'string', description: 'e.g. Aviation, Land, Maritime.' },
        limit: { type: 'number', description: 'How many to return. Default 5, max 15.' },
      },
    },
  },
  {
    name: 'goldmine_snapshot',
    description:
      'Read the CURRENT No-Quote Goldmine: solicitations where nobody quoted at all, split into make-side (no supplier matched in the availability data) versus sourcing-side, with the real size of buy. Call for any question about no-quotes or unfilled demand.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Top rows to name. Default 5.' } },
    },
  },
  {
    name: 'supplier_snapshot',
    description:
      'Read the CURRENT distressed-supplier book: how many firms, how many Tier-A prospects, how many verified contacts, and the top prospects. Call for any question about suppliers or who to contact.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Top firms to name. Default 5.' } },
    },
  },
]

/**
 * Client tools. The browser executes these; the server only decides that they should happen.
 * Every one of them is a thing the operator could have done with a mouse, which is the point.
 */
export const CLIENT_TOOLS: ToolSpec[] = [
  {
    name: 'navigate',
    description:
      'Take the operator to a page. Use this whenever they ask to go somewhere, or when showing them beats telling them. Do it, then say one short line about what they are looking at.',
    input_schema: {
      type: 'object',
      properties: {
        surface: {
          type: 'string',
          description:
            'One of: dashboard, monopoly, intelligence, goldmine, hubzone, competitor, suppliers, sales, documents, settings, admin.',
        },
      },
      required: ['surface'],
    },
  },
  {
    name: 'open_dossier',
    description: 'Open the full corner dossier page for one stock number.',
    input_schema: {
      type: 'object',
      properties: { nsn: { type: 'string', description: 'The stock number to open.' } },
      required: ['nsn'],
    },
  },
  {
    name: 'set_filter',
    description:
      'Apply filters on the Monopoly Map for the operator, so the screen in front of them changes to match what they asked for. Navigate there first if they are elsewhere.',
    input_schema: {
      type: 'object',
      properties: {
        on_forecast: { type: 'boolean' },
        rising_price: { type: 'boolean' },
        machine_award: { type: 'boolean' },
        has_price: { type: 'boolean' },
        supply_chain: { type: 'string' },
      },
    },
  },
]

export const ALL_TOOLS: ToolSpec[] = [...SERVER_TOOLS, ...CLIENT_TOOLS]
const SERVER_NAMES = new Set(SERVER_TOOLS.map((t) => t.name))
export const isServerTool = (name: string) => SERVER_NAMES.has(name)

/* ------------------------------------------------------------------------------------------- */
/* EXECUTION                                                                                     */
/* ------------------------------------------------------------------------------------------- */

export type ToolOutcome = {
  /** What goes back to the model as the tool result. Already shaped for speaking. */
  text: string
  /** Real figures this call produced. They join the grounding allow-set for this conversation. */
  numbers: number[]
  isError?: boolean
  /**
   * Set when the call was refused because the CALLER may not read what it returns. It is not an
   * error and it is not an empty result, and the interface must not draw it as either: it is a
   * permission boundary, and the operator has to be able to tell those three apart on screen.
   */
  refused?: ToolRefusal
}

const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? 'not measured' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`

/** Harvest every number in a result so the firewall can recognise it as real. */
function harvest(...vals: Array<number | null | undefined>): number[] {
  return vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}

export async function runServerTool(
  name: string,
  input: Record<string, unknown>,
  access: ToolAccess,
): Promise<ToolOutcome> {
  /*
   * ==========================================================================================
   * THE PERMISSION CHECK RUNS BEFORE ANYTHING IS READ, AND BEFORE ANYTHING IS SAID ABOUT THE FEED.
   * ==========================================================================================
   * First, because a caller who may not see supplier identities must be told THAT, and not told
   * that the feed is unmounted or that their stock number is not in the book. Those are three
   * different facts and answering with the wrong one is how an operator learns to read a
   * permission boundary as a data gap.
   *
   * `access` is a required argument rather than an optional one on purpose. An optional caller
   * defaults to something, and whatever it defaulted to would be the permission every forgotten
   * call site quietly ran with. The type makes forgetting it a compile error instead.
   */
  const refusal = refuseTool(name, access)
  if (refusal) return { text: refusal.text, numbers: [], refused: refusal }

  const root = resolveDataRoot()
  if (!root.present) {
    /*
     * An honest empty state, not a soft failure. If the data directory is not mounted, Thomas must
     * say the feed is not here rather than answer from background knowledge, because background
     * knowledge sounds identical to a live reading and the operator cannot tell them apart.
     */
    return {
      text: 'THE FEED IS NOT MOUNTED in this environment, so there is no live data to read. Tell the operator plainly that you cannot pull live numbers here, and do not substitute remembered figures.',
      numbers: [],
      isError: true,
    }
  }

  try {
    switch (name) {
      case 'lookup_stock_number':
        return lookupStockNumber(String(input.nsn ?? ''))
      case 'portfolio_snapshot':
        return portfolioSnapshot(access)
      case 'find_opportunities':
        return findOpportunities(input)
      case 'goldmine_snapshot':
        return goldmineSnapshot(Number(input.limit) || 5)
      case 'supplier_snapshot':
        return supplierSnapshot(Number(input.limit) || 5)
      default:
        return { text: `No tool named ${name}.`, numbers: [], isError: true }
    }
  } catch (e) {
    // Fail soft in words the model can use. A thrown tool must never dead-air a live conversation.
    return {
      text: `That lookup failed: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown error'}. Tell the operator it did not come back and offer to try again, do not answer from memory.`,
      numbers: [],
      isError: true,
    }
  }
}

function lookupStockNumber(raw: string): ToolOutcome {
  const key = raw.replace(/[^0-9]/g, '')
  if (key.length < 9) {
    return { text: 'That does not look like a stock number. Ask the operator to read it again.', numbers: [] }
  }
  const { cornerMap } = buildAllDatasets()
  const row = cornerMap.rows.find((r) => r.nsn.replace(/[^0-9]/g, '') === key)
  if (!row) {
    return {
      text: `Stock number ${raw} is NOT in the current feed day. Say that plainly. It does not mean the part does not exist, only that it is not in this candidate book.`,
      numbers: [],
    }
  }
  const awardIx = buildNsnAwardIndex()
  const fcIx = buildForecastIndex()
  const award = awardIx.ok ? awardIx.byNsn.get(key) ?? null : null
  const forecast = fcIx.ok ? fcIx.byNsn.get(key) ?? null : null
  const score = scoreCorner(row, award, forecast, {
    awardIndexLoaded: awardIx.ok,
    forecastIndexLoaded: fcIx.ok,
  })
  /*
   * ★ THE CONCIERGE SPEAKS THIS ALOUD, so it must not say a part has never been bought when the
   * export simply stopped before reaching it. Same verdict the corner page passes; without it
   * Thomas states "no award history" for 669 stock numbers on voice and chat alike.
   */
  const d = buildCornerDossier(
    row,
    award,
    forecast,
    score,
    awardIx.ok ? awardIx.window : undefined,
    awardIx.ok ? awardHistoryState(awardIx, row.nsn) : undefined,
  )

  const p = d.pricing
  const lines = [
    `LIVE DOSSIER for ${d.nsn}, "${d.item}".`,
    `Sole source: ${d.source.soleSource ? 'yes' : 'no'}. Approved sources: ${d.source.approvedSourceCount}${d.source.approvedSources.length ? ` (${d.source.approvedSources.slice(0, 4).join(', ')})` : ''}. Award-silent: ${d.source.awardSilent ? 'yes' : 'no'}.`,
    `Awards on record: ${p.awardCount}. First unit price ${money(p.firstUnitPrice)}, last unit price ${money(p.lastUnitPrice)}${p.escalationPct != null ? `, escalation ${p.escalationPct} percent` : ', escalation not computable'}. Distinct awardees: ${p.distinctAwardees ?? 'not measured'}.`,
    `On the DLA forecast: ${d.forecast.onForecast ? 'yes' : 'no'}${d.forecast.totalForecastQty != null ? `, forecast quantity ${d.forecast.totalForecastQty}` : ''}${d.forecast.supplyChains.length ? `, supply chain ${d.forecast.supplyChains.join(', ')}` : ''}.`,
    `CornerScore ${d.score.scoreV0}, grade ${d.score.grade}, disposition ${d.score.disposition}. Award path: ${d.awardPath}.`,
  ]
  if (d.source.crossReference?.note) lines.push(`Approved-source reconciliation: ${d.source.crossReference.note}`)
  lines.push(
    'REMINDER: quote these figures exactly as given. Do not compute totals, contract values, or any figure not listed here.',
  )

  return {
    text: lines.join('\n'),
    numbers: harvest(
      p.firstUnitPrice,
      p.lastUnitPrice,
      p.escalationPct,
      p.awardCount,
      p.distinctAwardees,
      d.score.scoreV0,
      d.source.approvedSourceCount,
      d.forecast.totalForecastQty,
      d.forecast.solicitationCount,
    ),
  }
}

function portfolioSnapshot(access: ToolAccess): ToolOutcome {
  const pf = buildPortfolio()
  if (!pf.ok) {
    return { text: 'The portfolio could not be built from the current feed. Say so honestly.', numbers: [], isError: true }
  }
  const t = pf.totals
  /*
   * THE FEED DAY IS GROUNDED IN BOTH SHAPES IT CAN BE SPOKEN IN. The engine stores it as
   * 2026-08-14, and Thomas says "August fourteenth" out loud, so the day and month never appear as
   * standalone figures and the strict guard rejected a perfectly correct answer. Same fact, two
   * renderings, both allowed. Grounding must follow how a number is actually said, or it starts
   * blocking the truth, which trains exactly the wrong instinct.
   */
  const feedParts = (pf.feedDay.match(/(\d{4})-(\d{2})-(\d{2})/) ?? []).slice(1).map(Number)
  const chains = pf.bySupplyChain.slice(0, 5).map((c) => `${c.label} ${c.value}`).join(', ')
  const top = pf.topCorners
    .slice(0, 5)
    .map((c) => `${c.nsn} "${c.item}" score ${c.score}${c.escalationPct != null ? `, up ${c.escalationPct} percent` : ''}`)
    .join('; ')
  return {
    text: [
      `LIVE PORTFOLIO, feed day ${pf.feedDay}.`,
      `Candidate corners ${t.candidateCorners}. On forecast ${t.onForecast}. Priced ${t.priced}. Machine-award eligible ${t.machineAward}. With measured escalation ${t.withEscalation}.`,
      `By supply chain: ${chains || 'not measured'}.`,
      `Top corners by score right now: ${top || 'none ranked'}.`,
      'REMINDER: these are the current live totals. Quote them exactly; do not add them together or derive new figures.',
    ].join('\n'),
    /*
     * A HARVESTED NUMBER IS A SPEAKABLE NUMBER, SO THE HARVEST SHRINKS WITH THE PERMISSION.
     * Everything returned here joins the conversation's allow-set and its measured set, which is
     * what makes the numeral firewall accept it. This tool only needs `board.view`, and its spoken
     * text carries no unit price, but it was harvesting `lastPrice` and `firstPrice` off the top
     * corners anyway. For a caller without `margin.view` that would leave a price pre-cleared for
     * speaking on a line where the pricing tools refuse, which is the firewall being widened by a
     * permission refusal instead of narrowed by it. The scores and the escalation percentages stay:
     * they are the board's own ranking, they are what this screen shows a read-only viewer, and no
     * dollar figure can be recovered from them.
     */
    numbers: harvest(
      t.candidateCorners,
      t.onForecast,
      t.priced,
      t.machineAward,
      t.withEscalation,
      ...feedParts,
      ...pf.bySupplyChain.map((c) => c.value),
      ...pf.topCorners.slice(0, 5).flatMap((c) => [c.score, c.escalationPct]),
      ...(can(access.held, 'margin.view')
        ? pf.topCorners.slice(0, 5).flatMap((c) => [c.lastPrice, c.firstPrice])
        : []),
    ),
  }
}

function findOpportunities(input: Record<string, unknown>): ToolOutcome {
  const pf = buildPortfolio()
  if (!pf.ok) return { text: 'The corner map could not be read right now.', numbers: [], isError: true }

  const q = String(input.query ?? '').trim().toLowerCase()
  const chain = String(input.supply_chain ?? '').trim().toLowerCase()
  const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 15)

  let rows = pf.topCorners.slice()
  if (q) rows = rows.filter((r) => `${r.item} ${r.nsn}`.toLowerCase().includes(q))
  if (input.on_forecast === true) rows = rows.filter((r) => r.onForecast)
  if (input.machine_award === true) rows = rows.filter((r) => r.machineAward)
  if (input.rising_price === true) rows = rows.filter((r) => (r.escalationPct ?? 0) > 0)
  if (chain) rows = rows.filter((r) => r.supplyChains.some((s) => s.toLowerCase().includes(chain)))

  if (!rows.length) {
    return {
      text: 'NOTHING MATCHES those filters in the current book. Say that plainly and offer to loosen one of them. Do not invent a near-miss.',
      numbers: [],
    }
  }
  const picked = rows.slice(0, limit)
  return {
    text: [
      `${rows.length} match, showing ${picked.length}:`,
      ...picked.map(
        (r, i) =>
          `${i + 1}. ${r.nsn} "${r.item}" score ${r.score} grade ${r.grade}${r.lastPrice != null ? `, last price ${money(r.lastPrice)}` : ''}${r.escalationPct != null ? `, up ${r.escalationPct} percent` : ''}${r.onForecast ? ', on forecast' : ''}`,
      ),
      'REMINDER: quote these exactly. Do not total them or estimate a market size from them.',
    ].join('\n'),
    numbers: harvest(rows.length, ...picked.flatMap((r) => [r.score, r.lastPrice, r.firstPrice, r.escalationPct, r.awardCount])),
  }
}

function goldmineSnapshot(limit: number): ToolOutcome {
  const g = buildNoQuoteGoldmine()
  const s = g.summary
  const make = g.rows.filter((r) => r.noHolderFound)
  /*
   * SIZE OF BUY IS COMPUTED HERE, IN DETERMINISTIC CODE, AND NEVER BY THE MODEL. Quantity times
   * last sold price, summed only over rows carrying BOTH, with the count of contributing rows
   * reported alongside it. That denominator is not decoration: a total over an unknown fraction of
   * the set reads as a total over all of it, which is how a partial measurement becomes a false
   * headline.
   */
  let makeValue = 0
  let priced = 0
  for (const r of make) {
    if (r.quantity != null && r.lastSoldPrice != null && r.quantity > 0 && r.lastSoldPrice > 0) {
      makeValue += r.quantity * r.lastSoldPrice
      priced += 1
    }
  }
  const top = make
    .filter((r) => r.quantity != null && r.lastSoldPrice != null)
    .sort((a, b) => (b.quantity! * b.lastSoldPrice!) - (a.quantity! * a.lastSoldPrice!))
    .slice(0, Math.min(Math.max(limit, 1), 10))

  return {
    text: [
      `LIVE NO-QUOTE GOLDMINE. Solicitations that drew no quote at all: ${s.solicitations}. Somebody holds material: ${s.withHolder}. MAKE-SIDE, no supplier matched in the availability data: ${s.makeSideOnly}. That is the absence of a match over the suppliers that data covers, NOT a census of the world: do not say nobody holds it anywhere.`,
      `Size of buy across the make-side rows that carry both a quantity and a last sold price: ${money(makeValue)}, computed over ${priced} of ${make.length} make-side rows. The rest do not carry both figures, so they are not in that total.`,
      ...top.map(
        (r, i) =>
          `${i + 1}. ${r.nsn} "${r.description}" quantity ${r.quantity}, last sold ${money(r.lastSoldPrice)}, solicitation ${r.solicitation}`,
      ),
      'These are CLOSED solicitations. They prove the lane exists, they are not open to bid right now. Say so if it could be misread.',
      'REMINDER: every figure above is already computed. Do not re-sum, extend, or extrapolate any of them.',
    ].join('\n'),
    numbers: harvest(
      s.solicitations,
      s.withHolder,
      s.makeSideOnly,
      s.availabilityRows,
      makeValue,
      priced,
      make.length,
      ...top.flatMap((r) => [r.quantity, r.lastSoldPrice]),
    ),
  }
}

function supplierSnapshot(limit: number): ToolOutcome {
  const d = buildDistressed()
  const s = d.summary
  const top = d.firms.slice(0, Math.min(Math.max(limit, 1), 10))
  /*
   * THE IN-BUSINESS COUNT NEVER SHIPS WITHOUT ITS DENOMINATOR. The engine's own comment is explicit
   * that a zero here means either "nobody is trading" or "nobody filled the column in", and that on
   * the real file it is the second. Handing the model the numerator alone would let it say "none of
   * them are still trading", which is a confident lie about live companies.
   */
  const inBusiness =
    s.inBusinessColumnPopulated > 0
      ? `${s.statedStillInBusiness} of the ${s.inBusinessColumnPopulated} firms whose in-business column is actually filled in state they are still trading`
      : `the in-business column is UNWRITTEN on this file, so we cannot say how many are still trading. Do not report zero as an answer`

  return {
    text: [
      `LIVE AWARD-SILENCE BOOK. Candidate firms ${s.candidates}. Enriched with contact detail ${s.enriched}. Carrying no enrichment row at all ${s.withoutEnrichment}.`,
      `In-business signal: ${inBusiness}.`,
      ...top.map(
        (f, i) =>
          `${i + 1}. ${f.company ?? 'unnamed'} (CAGE ${f.cage})${f.state ? `, ${f.state}` : ''}${f.awardsInWindow != null ? `, ${f.awardsInWindow} awards in window` : ''}${f.enrichmentMissing ? ', NO enrichment row' : ''}`,
      ),
      d.gaps.length ? `Known gaps in this dataset: ${d.gaps.join('; ')}` : '',
      'Nothing here calls a firm distressed. The publishable statement is the measurement.',
      'Outreach is single-operator: the platform drafts, the human sends. Never offer to send anything automatically.',
    ]
      .filter(Boolean)
      .join('\n'),
    numbers: harvest(
      s.candidates,
      s.enriched,
      s.withoutEnrichment,
      s.statedStillInBusiness,
      s.inBusinessColumnPopulated,
      ...top.map((f) => f.awardsInWindow ?? null),
    ),
  }
}
