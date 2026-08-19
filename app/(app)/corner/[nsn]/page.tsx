import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { requireGateSession } from '@/lib/session/require-gate'
import { callerCan, readCaller } from '@/lib/session/authz'
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { parseNsn, formatNsn } from '@/lib/intelligence/niin'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'
import { buildCornerDossier, priceSeries } from '@/lib/intelligence/brief/dossier'
import { dispositionLabel } from '@/lib/intelligence/scoring/evidence-state'
import { PriceSparkline } from '@/components/ui/PriceSparkline'
import { StatusChip } from '@/components/ui/StatusChip'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { PursueButton } from '@/components/sales/PursueButton'
import { PursuitPackagePanel } from '@/components/sales/PursuitPackagePanel'
import { findDealByRef } from '@/lib/sales/deals-store'
import { aiConfigured } from '@/lib/ai/anthropic'
import { sendPreflight } from '@/lib/notify/email'
import { readSettings } from '@/lib/notify/settings'
import { Scrollable } from '@/components/ui/Scrollable'
import { RecommendationPanel } from '@/components/pricing/RecommendationPanel'
import { QuoteAuditTrail } from '@/components/pricing/QuoteAuditTrail'
import { ClearingCurve } from '@/components/pricing/ClearingCurve'
import { MultiplePresets } from '@/components/pricing/MultiplePresets'
import {
  AWARD_MULTIPLE_PRESETS,
  RECOMMENDATION_CONFIG,
  presetForMultiple,
} from '@/lib/intelligence/pricing/recommend'
import { buildPerNsnClearing, clearingCurve } from '@/lib/intelligence/pricing/clearing-curve'
import { fscOf } from '@/lib/intelligence/pricing/recommend'
import { buildQuoteView, toDossierAward } from '@/lib/intelligence/pricing'
import { readSeriesLedger } from '@/lib/ingest/series/store'
import { resolveLiveIndexConfig, seriesVintageAsOf } from '@/lib/engine/pricing/live-indices'
import {
  buildFscPeerPool,
  liveClassifierOrNull,
  peerLookupFrom,
  recommendForCorner,
} from '@/lib/intelligence/pricing/for-corner'
import { AiBrief } from './AiBrief'
import styles from './corner.module.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ nsn: string }>
}): Promise<Metadata> {
  const { nsn } = await params
  return { title: `${nsn} · Corner dossier · ONLYSOURCE` }
}

const usd = (n: number | null): string =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const LEG_LABEL: Record<string, string> = {
  demand: 'Demand',
  competition: 'Competition',
  path: 'Award path',
  priceAnchor: 'Price anchor',
  forwardDemand: 'Forward demand',
  feasibility: 'Feasibility',
}

/**
 * Micro-explainers on specific score signals. Keyed on `leg` alone or `leg·facet`, so the
 * jargon-heavy cards (the flat surplus evaluated adder, the unwired ILS feed) carry the
 * eye-in-circle affordance the house requires on every metric.
 */
const REASON_HELP: Record<string, string> = {
  'priceAnchor·surplus drag': 'monopoly.surplus_drag',
  feasibility: 'monopoly.ils',
}

/**
 * THE CORNER DOSSIER PAGE.
 *
 * One stock number, read all the way down: the real price trajectory, the whole award history, the
 * forecast demand, the score decomposed into its five evidence-graded legs, and the open gaps. On
 * top of that sits the AI opportunity brief, which is written only from the same measured dossier
 * this page renders. Nothing here is estimated to fill a gap; an unread leg says it is unread.
 */
export default async function CornerPage({
  params,
  searchParams,
}: {
  params: Promise<{ nsn: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireGateSession('/monopoly')
  const { nsn: nsnParam } = await params
  const key = decodeURIComponent(nsnParam).replace(/[^0-9]/g, '')

  const root = resolveDataRoot()
  if (!root.present) {
    return (
      <main className={styles.page}>
        <Link href={'/monopoly' as never} className={styles.back}>
          ← Monopoly Map
        </Link>
        <div className={styles.unavailable}>
          <h1 className={styles.unavailableTitle}>The data directory is not mounted here</h1>
          <p>This dossier is computed from the government feed files, and this environment has none.</p>
        </div>
      </main>
    )
  }

  const { cornerMap } = buildAllDatasets()
  const row = cornerMap.rows.find((r) => r.nsn.replace(/[^0-9]/g, '') === key)
  if (!row) {
    // An honest in-shell message rather than a bare 404. (A streamed shell means notFound() would
    // land after the layout flushes and read as a blank page, so this is both clearer and correct.)
    return (
      <main className={styles.page}>
        <Link href={'/monopoly' as never} className={styles.back}>
          ← Monopoly Map
        </Link>
        <div className={styles.unavailable}>
          <h1 className={styles.unavailableTitle}>That stock number isn&rsquo;t in this feed</h1>
          <p>
            No dossier exists for <span className="mono">{decodeURIComponent(nsnParam)}</span> in today&rsquo;s
            data. It may not be a sole-source position, or it may not appear on this feed day. Head back to
            the Monopoly Map to find the corners that are here.
          </p>
        </div>
      </main>
    )
  }

  const awardIx = buildNsnAwardIndex()
  const fcIx = buildForecastIndex()
  const award = awardIx.ok ? awardIx.byNsn.get(key) ?? null : null
  const forecast = fcIx.ok ? fcIx.byNsn.get(key) ?? null : null
  const score = scoreCorner(row, award, forecast, {
    awardIndexLoaded: awardIx.ok,
    forecastIndexLoaded: fcIx.ok,
  })
  const dossier = buildCornerDossier(row, award, forecast, score, awardIx.ok ? awardIx.window : undefined)
  const series = priceSeries(dossier)

  // THE PURSUIT WIRE: the dossier's primary action. The modeled buy value is quantity x the
  // latest measured award unit price, only when both are on record; otherwise the deal is
  // created honestly valueless. Pursued state reads from the real store on every visit.
  const latestUnit = award?.latest?.effectiveUnitPrice ?? null
  const modeledBuyValue =
    row.quantity != null && latestUnit != null && latestUnit > 0 ? row.quantity * latestUnit : null
  const alreadyPursued = findDealByRef(row.nsn) != null

  /*
   * THE RECOMMENDATION. The clock is read ONCE here and passed down, because every threshold
   * and band the engine resolves is dated and a second read further down would let two parts
   * of one page price the same row against two different days.
   *
   * The peer pool is only built when the award index actually loaded. Handing the engine an
   * empty lookup off a failed index would let the weakest rung report "no priced peers in this
   * class" when the truth is that the class was never read, and those are different sentences.
   */
  const nowMs = Date.now()
  const peers = awardIx.ok ? peerLookupFrom(buildFscPeerPool(awardIx.byNsn)) : null

  /*
   * ★ THE INFLATION FACTOR IS READ FROM THE INGESTED SERIES, NOT PINNED IN SOURCE.
   *
   * The anchor carried 1.3223, which was never a judgement: it is a READING of BLS CPI-U
   * CUUR0000SA0 taken in November 2025, and a reading goes stale. The same series at 2026-M07
   * gives 1.3623, so every anchored figure computed from the constant is about 3 percent LOW and
   * drifts further every month with no code change and no alert.
   *
   * That was a labelling problem while the product only displayed four auditable figures. It
   * stopped being one the moment the product began recommending a number an operator types into
   * DIBBS: a silently stale factor is then a wrong recommendation WITH A CITATION ON IT.
   *
   * The ledger is read HERE, at the edge, and injected. `buildQuoteView` and `recommendPrice`
   * are pure and synchronous and must stay that way, or no test can hand them a world with a
   * known answer. On abstention the pinned factor is kept and carries its own vintage, because
   * dropping the anchor would make a wiring gap look identical to thin evidence about the item.
   *
   * ★ THE VINTAGE IS A UTC DATE, NOT THE PAGE'S EASTERN `asOf`, AND THE DIFFERENCE IS NOT
   * COSMETIC. Series vintages are stamped from `retrieved_at`, which is UTC, while feed days use
   * the Eastern civil date. Passing `measuredOn` here made the ledger's only vintage look like it
   * was published tomorrow, so every reading was correctly refused and the anchor fell back to
   * the pinned figure silently. See `seriesVintageAsOf`.
   */
  /*
   * ★ `margin.view` RESOLVED ON A READ PATH, WHICH IS WHERE THIS PRODUCT HAD NO CHECKS AT ALL.
   *
   * Four of the fourteen permissions govern SEEING a fact rather than doing one, and permissions
   * here are enforced at the point of ACTION, so a server-rendered page enforced none of them.
   * The pricing engine can emit exactly one margin-shaped figure and it travels as a SENTENCE,
   * through the recommendation's inputs and caveats, where no component names the field and a
   * reachability census calls it unreached.
   *
   * It does not render today only because the two multiples the product has words for, 1 and the
   * operator's 3x, use hand-written sentences. The control that lets an operator pick any other
   * multiple is the next thing being built, so the check goes on now, while the room is empty.
   */
  const mayReadMargin = callerCan(await readCaller(), 'margin.view')

  /*
   * ★ THE CHOSEN MULTIPLE IS VALIDATED AGAINST THE PRESET LIST, NEVER TAKEN FROM THE URL.
   *
   * This is a security boundary and not only hygiene. A multiple outside the preset list routes
   * through `measuredRecordSentence`, which is the one place this engine can emit margin-shaped
   * prose, and margin is gated by `margin.view`. Accepting an arbitrary URL value would let a
   * caller choose which code path runs. `presetForMultiple` matches BY VALUE, so an unknown
   * number falls back to the product default rather than reaching the engine.
   */
  const rawMultiple = (await searchParams).m
  const askedFor = Number(Array.isArray(rawMultiple) ? rawMultiple[0] : rawMultiple)
  const chosenPreset = Number.isFinite(askedFor) ? presetForMultiple(askedFor) : null
  const activeMultiple = chosenPreset?.value ?? RECOMMENDATION_CONFIG.awardMultiple
  const pricingConfigForRow =
    chosenPreset === null
      ? RECOMMENDATION_CONFIG
      : { ...RECOMMENDATION_CONFIG, awardMultiple: chosenPreset.value }

  const seriesLedger = await readSeriesLedger()
  const liveIndices = resolveLiveIndexConfig(seriesLedger, seriesVintageAsOf(nowMs))

  /*
   * THE DECISION SURFACE. The recommendation answers "what is this worth"; this answers "what
   * does asking for more cost me", which is the question the product cannot answer FOR the
   * operator because it does not hold their cost. Built only when the award index loaded: an
   * empty curve off a failed index would read as "nothing ever cleared" when the truth is that
   * nothing was read, and those are different sentences.
   */
  const clearing = awardIx.ok
    ? clearingCurve(buildPerNsnClearing(awardIx.byNsn), fscOf(row.nsn))
    : null

  const recommendation = recommendForCorner({
    nsn: row.nsn,
    award,
    requirementQuantity: row.quantity,
    approvedSourceCages: row.approvedSources,
    feedWindow: awardIx.ok ? awardIx.window : undefined,
    atInstantMs: nowMs,
    peerLookup: peers,
    classifier: liveClassifierOrNull(),
    indices: liveIndices.config,
    mayReadMargin,
    config: pricingConfigForRow,
  })

  /*
   * THE AUDIT TRAIL UNDER THE RECOMMENDATION. Added by @PRICE-SURFACE, ADDITIVE: nothing above
   * this block was changed, moved or reworded.
   *
   * ★ THIS IS THE FIRST CALLER `buildQuoteView` HAS EVER HAD. Roughly 2,270 lines of tested
   * pricing engine and nine test files, and `grep -rln buildQuoteView app components` returned
   * nothing. The four separately auditable figures this product was built around had never been
   * on a screen. That is this estate's dominant failure shape rather than an oversight: built and
   * wired and never fed, and the cure is a caller.
   *
   * The owner lifting the rule that forbade a single recommended number did not delete the
   * arithmetic that justifies one. The four figures stay underneath as the working, and beside
   * them go the INPUTS the winning rung consumed, each with its own date and its own source,
   * which is what makes a figure defensible to a buyer rather than merely printed.
   *
   * The SAME `nowMs` the recommendation was priced at is passed here. A second clock read would
   * let the recommendation and the audit trail beneath it price one row against two instants,
   * and every threshold and band in this engine is dated.
   *
   * Nothing is declared on the operator's behalf: the three declaration fields stay null rather
   * than defaulting to false, because "we are not offering surplus" and "nobody has said" are
   * different facts, and reading the silence as a false omits an applicable evaluation factor
   * and overstates our competitiveness on a price-alone evaluation.
   */
  const quoteView = buildQuoteView({
    nsn: row.nsn,
    awards: award ? award.awards.map(toDossierAward) : [],
    approvedSourceCages: row.approvedSources,
    solicitationQuantity: row.quantity,
    solicitation: row.solicitation,
    automatedSolicitation: row.automatedSolicitation,
    atInstantMs: nowMs,
    feedWindow: awardIx.ok ? awardIx.window : { firstAwardIso: null, lastAwardIso: null },
    proposedUnitPriceUsd: null,
    offeringUnusedFormerGovernmentSurplus: null,
    esaCoordinationCount: null,
    buyAmericanOrBalanceOfPayments: null,
    indices: liveIndices.config,
  })

  return (
    <main className={styles.page}>
      <Link href={'/monopoly' as never} className={styles.back}>
        ← Monopoly Map
      </Link>

      {/* ------------------------------------------------------------------ header */}
      <header className={styles.head}>
        <div className={styles.headMain}>
          <p className={styles.eyebrow}>Corner dossier</p>
          {/*
            * THE HEADING SHOWS THE HUMAN STOCK NUMBER, NOT THE JOIN KEY.
            *
            * This rendered `1005017317348` while every other surface in the product shows
            * `1005-01-731-7348`. It is the page's main heading: the first thing a screen reader
            * announces and the thing the tab title carries, on the flagship dossier.
            *
            * `formatNsn` is the product's one display formatter, reused rather than reimplemented.
            * If the number cannot be parsed the RAW value is shown rather than nothing, because a
            * heading that silently empties is worse than an unformatted one.
            */}
          <h1 className={`mono ${styles.nsn}`}>
            {(() => {
              // `fsc` is nullable by design: a NIIN alone is a complete, valid stock number and
              // has no class to hyphenate. Format only when the class is actually present.
              const parsed = parseNsn(row.nsn)
              return parsed?.fsc ? formatNsn(parsed.fsc, parsed.niin) : row.nsn
            })()}
          </h1>
          <p className={styles.item}>{dossier.item}</p>
          <div className={styles.chips}>
            {row.soleSource ? (
              // Brass accent, matching the Monopoly grid's chip for the same fact. Amber is
              // reserved for the award clock.
              <StatusChip tone={dossier.source.awardSilent ? 'accent' : 'verified'}>
                {dossier.source.awardSilent ? 'Sole + silent' : 'Sole source'}
                {row.approvedSources[0] ? ` · ${row.approvedSources[0]}` : ''}
              </StatusChip>
            ) : (
              <StatusChip tone="idle">{row.approvedSourceCount} approved sources</StatusChip>
            )}
            {dossier.forecast.onForecast ? (
              <StatusChip tone="verified">
                On DLA Forecast
                {dossier.forecast.totalForecastQty ? ` · ${dossier.forecast.totalForecastQty.toLocaleString()}` : ''}
              </StatusChip>
            ) : null}
            {dossier.awardPath === 'machine_award' ? (
              <StatusChip tone="active">Machine award</StatusChip>
            ) : dossier.awardPath === 'manual' ? (
              <StatusChip tone="idle">Manual award</StatusChip>
            ) : null}
            {dossier.awardPath !== 'unknown' ? (
              <ExplainButton helpId="monopoly.award_path" size="sm" />
            ) : null}
          </div>
          <div className={styles.pursueRow}>
            <PursueButton
              appearance="primary"
              nsn={row.nsn}
              niin={row.niin}
              item={dossier.item}
              valueUsd={modeledBuyValue}
              initiallyInPipeline={alreadyPursued}
            />
            {/*
             * THE DOOR THAT EXISTED AND WAS NEVER OPENED.
             *
             * `/documents?from=corner:<nsn>` was fully implemented on the receiving side,
             * tested, and documented as a stable contract, and nothing in the product linked
             * to it. So the operator finished deciding here and then retyped the stock number,
             * the item and the quantity into a blank form on the next screen, which is the
             * whole reason that screen was described as producing "a checklist and a wall of
             * text" rather than paperwork.
             *
             * It is one link. That is exactly what makes it worth writing down: this estate's
             * dominant failure is not missing code, it is finished code with no way in.
             */}
            <Link
              href={`/documents?from=corner:${encodeURIComponent(row.nsn)}` as Route}
              className={styles.docsLink}
              prefetch={false}
            >
              Build the paperwork for this part
            </Link>
          </div>
        </div>
        <div className={styles.scoreBox}>
          <span className={styles.scoreN}>{score.scoreV0}</span>
          {/* A div row, not a span: the explainer's popover is a <div>, invalid inside a span. */}
          <div className={styles.scoreCaptionRow}>
            <span className={styles.scoreCaption}>CornerScore</span>
            {/* The flagship score, explained where it is biggest: the entry plus this row's
                real point decomposition and its named data gaps. */}
            <ExplainButton
              helpId="score.corner_v0"
              size="sm"
              sourceDetail={`Scored from the feed-day corner row joined to the NSN-Now export · feed day ${cornerMap.provenance.feedDay}`}
              computation={{
                factors: score.reasons
                  .filter((x) => x.points !== 0)
                  .map((x) => ({ label: x.plain, contribution: x.points })),
                dataGaps: score.dataGaps,
                modelVersion: 'cornerscore-v0',
                asOf: cornerMap.provenance.feedDay,
              }}
            />
          </div>
          <StatusChip tone={score.disposition === 'FLAG' ? 'verified' : 'idle'}>
            {dispositionLabel(score.disposition)} · {score.grade}
          </StatusChip>
        </div>
      </header>

      {/* ------------------------------------------------------------ money + demand */}
      {/*
        THE RECOMMENDATION SITS ABOVE THE EVIDENCE, not below it. The operator's question is
        "what do I bid"; the award price, the quote signals and the forward demand under it are
        the working. Putting the working first would bury the answer.
      */}
      <RecommendationPanel rec={recommendation} />

      {/*
        THE WORKING, DIRECTLY UNDER THE ANSWER. @PRICE-SURFACE, additive: the panel above and its
        placement belong to @BUILD-THE-WIRES and neither was changed.

        It carries the two things a recommendation cannot be defended without and the panel does
        not render: every INPUT the winning rung consumed with its own date and source, and the
        FOUR separately auditable figures underneath. Collapsed on first paint, because the
        recommendation is the answer and this is the working, and every word of it stays in the
        DOM so the browser's own find, the keyboard and a screen reader all still reach it.

        Shown on an abstention too. When no rung reached, the four figures underneath are the only
        arithmetic on the page, which is exactly when an operator needs them.
      */}
      {/*
        THE DECISION SURFACE, BETWEEN THE ANSWER AND THE WORKING. The recommendation above says
        what the item is worth; this says what asking for more costs in the chance of clearing.
        The product deliberately stops short of naming the best bid, because that depends on the
        operator's cost and nothing here holds one.
      */}
      <MultiplePresets
        presets={AWARD_MULTIPLE_PRESETS}
        active={activeMultiple}
        basePath={`/corner/${encodeURIComponent(key)}`}
      />

      {clearing !== null && recommendation.resolved ? (
        <ClearingCurve curve={clearing} recommendedMultiple={recommendation.awardMultiple} />
      ) : null}

      <QuoteAuditTrail
        view={quoteView}
        inputs={recommendation.resolved ? recommendation.inputs : []}
      />

      <section className={styles.cards}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Award price</h2>
          {series.length > 0 ? (
            <>
              <div className={styles.chartFrame}>
                <PriceSparkline
                  points={series}
                  width={520}
                  height={140}
                  ariaLabel={`Unit price across ${series.length} awards for ${row.nsn}, from ${usd(dossier.pricing.firstUnitPrice)} to ${usd(dossier.pricing.lastUnitPrice)}`}
                  className={styles.chart}
                />
              </div>
              <dl className={styles.priceRow}>
                <div>
                  <dt>First award</dt>
                  <dd className="mono">{usd(dossier.pricing.firstUnitPrice)}</dd>
                </div>
                <div>
                  <dt>Latest award</dt>
                  <dd className="mono">{usd(dossier.pricing.lastUnitPrice)}</dd>
                </div>
                <div>
                  <dt>Change</dt>
                  <dd className="mono">
                    {dossier.pricing.escalationPct == null
                      ? '—'
                      : `${dossier.pricing.escalationPct > 0 ? '+' : ''}${dossier.pricing.escalationPct}%`}
                  </dd>
                </div>
                <div>
                  <dt>Awardees</dt>
                  <dd className="mono">{dossier.pricing.distinctAwardees ?? '—'}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className={styles.empty}>
              No award price is ingested for this stock number yet. Nothing is estimated in its place.
            </p>
          )}
        </div>

        {/*
          THE QUOTE CHECKLIST, COMPUTED. Every row is an indicator the operator who taught this
          business wrote down himself while deciding whether to quote a real requirement. Two of
          them are deliberately WITHHELD rather than shown, because the export column that would
          carry them is measurably contaminated, and the row says so in the operator's own view
          rather than in a comment nobody reads.
        */}
        {dossier.quoteSignals.length > 0 ? (
          <div className={`${styles.card} ${styles.signalsCard}`}>
            <h2 className={styles.cardTitle}>Quote signals</h2>
            <p className={styles.signalsIntro}>
              The indicators a trader checks before quoting, read from the government files on disk.
              Each one says what it is, and where the files cannot answer it says that instead.
            </p>
            <ul className={styles.signals}>
              {dossier.quoteSignals.map((s) => (
                <li key={s.id} className={styles.signal} data-state={s.leg.state} data-direction={s.direction}>
                  <div className={styles.signalHead}>
                    <span className={styles.signalDot} aria-hidden="true" />
                    <span className={styles.signalLabel}>{s.label}</span>
                    <StatusChip tone={s.leg.state === 'MEASURED' ? 'verified' : 'idle'}>
                      {s.leg.state === 'MEASURED'
                        ? s.direction === 'favourable'
                          ? 'in favor'
                          : s.direction === 'unfavourable'
                            ? 'against'
                            : 'measured'
                        : 'not read'}
                    </StatusChip>
                  </div>
                  <p className={styles.signalReading}>{s.reading}</p>
                  {s.limitation ? <p className={styles.signalLimit}>{s.limitation}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Forward demand</h2>
          {dossier.forecast.onForecast ? (
            <dl className={styles.factRows}>
              <div>
                <dt>On the DLA Forecast</dt>
                <dd>
                  <StatusChip tone="verified">Yes</StatusChip>
                </dd>
              </div>
              {dossier.forecast.totalForecastQty ? (
                <div>
                  <dt>Forecast quantity</dt>
                  <dd className="mono">{dossier.forecast.totalForecastQty.toLocaleString()}</dd>
                </div>
              ) : null}
              {dossier.forecast.solicitationCount ? (
                <div>
                  <dt>Solicitations drawn</dt>
                  <dd className="mono">{dossier.forecast.solicitationCount.toLocaleString()}</dd>
                </div>
              ) : null}
              {dossier.forecast.supplyChains.length > 0 ? (
                <div>
                  <dt>Supply chain</dt>
                  <dd>{dossier.forecast.supplyChains.join(', ')}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className={styles.empty}>
              This stock number is not on the government forward-buy list in the data on disk. Demand
              is read from the open solicitation only, not projected.
            </p>
          )}
          {dossier.forecast.endItems.length > 0 ? (
            <div className={styles.endItems}>
              <span className={styles.endItemsLabel}>Goes on</span>
              <div className={styles.endItemChips}>
                {dossier.forecast.endItems.slice(0, 8).map((e) => (
                  <span key={e} className={styles.endItemChip}>
                    {e}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------------------------------------ AI brief */}
      <AiBrief nsn={key} configured={aiConfigured()} />

      {/* ------------------------------------------------------------ pursuit package */}
      {(() => {
        // The email channel's TRUE state, computed server-side so the panel can say
        // "disarmed" before a click is ever spent. sendPreflight finally has its caller.
        const recipient = readSettings().emailRecipient
        const pf = sendPreflight(recipient)
        return (
          <PursuitPackagePanel
            nsn={key}
            configured={aiConfigured()}
            emailChannel={{ wouldSend: pf.wouldSend, reason: pf.reason, recipient }}
          />
        )
      })()}

      {/* ---------------------------------------------------------- award history */}
      {dossier.priceHistory.length > 0 ? (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Award history</h2>
          <p className={styles.cardSub}>
            Every prime award in the NSN-Now export for this stock number, in order. Real prices, not
            modeled.
          </p>
          <Scrollable className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Award date</th>
                  <th>Awardee</th>
                  <th className={styles.numCol}>Qty</th>
                  <th className={styles.numCol}>Unit price</th>
                  <th className={styles.numCol}>Final price</th>
                </tr>
              </thead>
              <tbody>
                {dossier.priceHistory.map((p, i) => (
                  <tr key={i}>
                    <td className="mono">{p.dateIso ?? '—'}</td>
                    <td>
                      {p.company ?? '—'}
                      {p.cage ? <span className={styles.cage}> {p.cage}</span> : null}
                    </td>
                    <td className={`mono ${styles.numCol}`}>{p.quantity?.toLocaleString() ?? '—'}</td>
                    <td className={`mono ${styles.numCol}`}>{usd(p.unitPrice)}</td>
                    <td className={`mono ${styles.numCol}`}>{usd(p.finalPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scrollable>
        </section>
      ) : null}

      {/* --------------------------------------------------------------- the legs */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>How the score is built</h2>
        <p className={styles.cardSub}>
          Five legs, each carrying its own evidence state. A leg can contribute more than one
          signal, so each card below names its leg and the signal it scores. A leg that was not
          measured is marked, and the score is capped honestly rather than pretending the leg was
          read.
        </p>
        <div className={styles.legGrid}>
          {score.reasons.map((r, i) => {
            const helpId = REASON_HELP[r.facet ? `${r.leg}·${r.facet}` : r.leg]
            return (
              <div key={i} className={styles.legRow}>
                <div className={styles.legHead}>
                  <span className={styles.legName}>
                    {LEG_LABEL[r.leg] ?? r.leg}
                    {r.facet ? ` · ${r.facet}` : ''}
                  </span>
                  {helpId ? <ExplainButton helpId={helpId} size="sm" /> : null}
                  <StatusChip tone={r.calibration === 'measured' ? 'verified' : 'idle'}>
                    {r.calibration}
                    {r.points ? ` · ${r.points > 0 ? '+' : ''}${r.points}` : ''}
                  </StatusChip>
                </div>
                <p className={styles.legPlain}>{r.plain}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* -------------------------------------------------------------- open gaps */}
      {dossier.openGaps.length > 0 ? (
        <section className={styles.gaps}>
          <h2 className={styles.gapsTitle}>What a full read is still waiting on</h2>
          <ul className={styles.gapList}>
            {dossier.openGaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}
