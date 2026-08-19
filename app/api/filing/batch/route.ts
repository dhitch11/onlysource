/**
 * THE DIBBS BATCH QUOTE FILE — the last unwired step of the close chain.
 *
 * ==========================================================================================
 * WHAT THIS IS, AND WHY IT DID NOT EXIST UNTIL NOW.
 * ==========================================================================================
 * `lib/filing` writes the 121-column file a defense-parts vendor uploads to DIBBS to quote a
 * solicitation: it overlays the vendor's decisions onto DLA's own pre-filled row, validates
 * against DLA's silent traps, and chunks to the 75-line limit. All of it finished, all of it
 * tested, and none of it reachable: `app/(app)/documents/page.tsx:102` names it in a comment as
 * "THE ONE THING DELIBERATELY NOT BUILT HERE".
 *
 * It was not missing code. It was code nothing could reach, for two reasons, and this route
 * closes the second one (`lib/filing/source.ts` closed the first by turning the archived
 * quoting zip into the 121-field rows the writer takes as input).
 *
 * ==========================================================================================
 * WHAT IT DELIBERATELY DOES NOT DO.
 * ==========================================================================================
 *  1. IT DOES NOT SUBMIT. It returns a file for a person to upload themselves. Transmitting a
 *     quote into a government system is an outward-facing act that is not authorized here, and
 *     `test/filing/no-network.test.ts` enforces that the whole `lib/filing` namespace is
 *     structurally incapable of opening a connection. This route adds no exception to that.
 *
 *  2. IT DOES NOT DECIDE A PRICE, AND IT WILL NOT ACCEPT AN ABSENT ONE. The unit price and
 *     delivery days arrive from the caller as already-formatted strings and are written through
 *     byte-for-byte. Nothing here computes, rounds or reformats a number, so a fabrication
 *     cannot originate in the filing layer. This matches the pricing engine's own doctrine,
 *     which forbids a single blended recommended figure and abstains on 98.1% of live rows: the
 *     figure on a quote is the operator's, typed by them, and this route requires it.
 *
 *  3. IT REFUSES RATHER THAN REPAIRS. A row that fails validation blocks the whole batch with
 *     the named problems returned. A quote file that DLA silently drops is worse than no file,
 *     because the operator believes they bid.
 */

import { NextRequest } from 'next/server'
import { requirePermission } from '@/lib/session/authz'
import { quoteSourceRows } from '@/lib/filing/source'
import { applyVendorQuote, buildBatch, rowKey, type SourceQuoteRow, type VendorQuote } from '@/lib/filing'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** One line the operator wants to quote, addressed by its natural key. */
type LineRequest = {
  /** The DLA solicitation number, e.g. "SPE1C126Q0426". */
  solicitation: string
  /** The CLIN. Required: a solicitation can publish more than one line and they price separately. */
  clin: string
  /** Already-formatted price string, e.g. "1620.00000". The operator owns this figure. */
  unitPrice: string
  /** Integer delivery days as a string, e.g. "120". */
  deliveryDays: string
} & Partial<Omit<VendorQuote, 'unitPrice' | 'deliveryDays' | 'quoterCage'>>

type BatchRequest = {
  /** The vendor's own CAGE, 5 characters. */
  quoterCage: string
  lines: LineRequest[]
  /** YYYYMMDD stamp for the filename. Supplied by the caller so no clock is read here. */
  dateStamp: string
}

const bad = (error: string, detail?: unknown) =>
  Response.json({ error, detail }, { status: 400 })

/**
 * GET — what is quotable today, so a surface can offer a choice rather than demand a
 * solicitation number the operator has to already know.
 *
 * Reports `offWidth` rather than hiding it: a day whose file was partially unreadable must not
 * look like a day that published fewer lines.
 */
export async function GET() {
  /*
   * `board.quote` is the permission that exists for exactly this act. Written out rather than
   * guessed: `requirePermission` takes a bare `string`, so a mistyped key compiles clean and
   * `can()` is `held.includes(key)`, which means an unknown key fails CLOSED and 403s every
   * caller including the owner. Safe direction, silent failure, invisible to tsc.
   */
  const denied = await requirePermission('board.quote')
  if (denied) return denied

  const source = quoteSourceRows()
  if (!source.ok) {
    // 200 with an honest unavailable, not a 500: "no archived day is servable" is a state of the
    // world this product is expected to render, not a fault in this request.
    return Response.json({ ok: false, reason: source.reason })
  }

  return Response.json({
    ok: true,
    feedDay: source.feedDay,
    member: source.member,
    storageKey: source.storageKey,
    quotableLines: source.rows.length,
    solicitations: source.bySolicitation.size,
    offWidthRecords: source.offWidth.length,
    offWidth: source.offWidth.slice(0, 20),
  })
}

/**
 * POST — build the batch file for a set of operator-decided lines.
 *
 * Returns the validated files with their checksums, or the blocking problems. Never a partially
 * valid file: `buildBatch` refuses the whole batch if any row blocks, because a vendor who
 * uploads 74 good lines and one silently dropped one has not quoted what they think they quoted.
 */
export async function POST(req: NextRequest) {
  const denied = await requirePermission('board.quote')
  if (denied) return denied

  let body: BatchRequest
  try {
    body = (await req.json()) as BatchRequest
  } catch {
    return bad('bad_request')
  }

  const quoterCage = String(body?.quoterCage ?? '').trim().toUpperCase()
  if (quoterCage.length !== 5) {
    return bad('quoter_cage_invalid', 'A CAGE code is exactly 5 characters.')
  }
  const dateStamp = String(body?.dateStamp ?? '').trim()
  if (!/^\d{8}$/.test(dateStamp)) {
    return bad('date_stamp_invalid', 'dateStamp must be YYYYMMDD. It names the file; no clock is read here.')
  }
  if (!Array.isArray(body?.lines) || body.lines.length === 0) {
    return bad('no_lines', 'A quote file with no lines is not a quote.')
  }

  const source = quoteSourceRows()
  if (!source.ok) {
    return Response.json({ ok: false, reason: source.reason }, { status: 409 })
  }

  const rows: SourceQuoteRow[] = []
  const notFound: string[] = []

  for (const line of body.lines) {
    const solicitation = String(line?.solicitation ?? '').trim().toUpperCase()
    const clin = String(line?.clin ?? '').trim()
    const unitPrice = String(line?.unitPrice ?? '').trim()
    const deliveryDays = String(line?.deliveryDays ?? '').trim()

    /*
     * THE PRICE IS REQUIRED AND IS NEVER DEFAULTED. There is no figure this route could supply
     * that would be honest: the pricing engine publishes no recommended quote, and the last
     * price the government paid is the incumbent's number, not ours. An absent price is a
     * refusal, never a fallback.
     */
    if (unitPrice === '') {
      return bad('unit_price_required', `No unit price for ${solicitation}::${clin}. This product publishes no recommended quote; the figure on a bid is the operator's own.`)
    }
    if (deliveryDays === '') {
      return bad('delivery_days_required', `No delivery days for ${solicitation}::${clin}.`)
    }

    const key = `${solicitation}::${clin}`
    const sourceRow = source.byKey.get(key)
    if (!sourceRow) {
      notFound.push(key)
      continue
    }

    rows.push(
      applyVendorQuote(sourceRow, {
        ...line,
        quoterCage,
        unitPrice,
        deliveryDays,
      } as VendorQuote),
    )
  }

  if (notFound.length > 0) {
    /*
     * NAMED, NOT SILENTLY SKIPPED. A line absent from the day's quote file may be open on a day
     * we do not hold, or may not be batch-quotable at all. Quietly returning a shorter file
     * would let an operator believe they had bid on something they had not.
     */
    return Response.json(
      {
        error: 'lines_not_in_feed_day',
        detail: `These (solicitation, CLIN) keys are not in the ${source.feedDay} quote file: ${notFound.join(', ')}. They may be open on a day this archive does not hold.`,
        feedDay: source.feedDay,
        notFound,
      },
      { status: 409 },
    )
  }

  const batch = buildBatch(rows, { dateStamp })
  if (!batch.ok) {
    return Response.json(
      {
        ok: false,
        error: 'validation_blocked',
        blocks: batch.blocks,
        warnings: batch.warnings,
        totalLines: batch.totalLines,
        detail: 'DLA drops a malformed quote silently. The whole batch is refused rather than filing a file that looks accepted.',
      },
      { status: 422 },
    )
  }

  return Response.json({
    ok: true,
    feedDay: source.feedDay,
    citedArchive: source.storageKey,
    totalLines: batch.totalLines,
    warnings: batch.warnings,
    files: batch.files.map((f) => ({
      filename: f.filename,
      index: f.index,
      total: f.total,
      lineCount: f.lineCount,
      checksum: f.checksum,
      body: f.body,
    })),
    note: 'This file is for the operator to upload to DIBBS. Nothing here transmits it.',
  })
}

export type { BatchRequest, LineRequest }
