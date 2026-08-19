import Link from 'next/link'

import { Money } from '@/components/ui/Money'
import { StatusChip } from '@/components/ui/StatusChip'
import { Scrollable } from '@/components/ui/Scrollable'
import type { BookMatch, DedicatedPull, MakerRow, SubjectPart } from '@/lib/intelligence/competitor/rural-route'

import styles from './competitor.module.css'
import rt from '@/components/ui/responsive-table.module.css'

/**
 * THE DEDICATED PULL VIEW. Rendered only for a company we hold a company-specific export for,
 * and deliberately unlike the generic teardown around it.
 *
 * THE RULE THIS FILE IS BUILT AROUND: a deep view and a shallow view wearing the same chrome
 * teach the operator that the shallow ones are complete. So this view is banded, titled and
 * labelled as the dedicated pull throughout, and the generic teardown below it says what it
 * is and what it is missing.
 *
 * Every number here is computed in `lib/intelligence/competitor/rural-route.ts` and passed in
 * whole. Nothing on this page adds up rendered rows.
 */

const MAKERS_SHOWN = 40
const PARTS_SHOWN = 60
const RIVALS_SHOWN = 20
const HOLDERS_SHOWN = 20

/** Deterministic on the server and in the browser alike. `toLocaleString` is neither. */
function count(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`
}

const ACCESS_WORDS: Record<string, string> = {
  open: 'open to a new source',
  source_approval_possible: 'source approval possible',
  closed_to_new_manufacturing: 'closed to new manufacturing',
  not_established: 'not established',
}

const MAKER_COLS = {
  maker: "Maker",
  tracedToThem: "Traced to them",
  sharedWithOtherApprovedSources: "Shared with other approved sources",
  referenceHeld: "Reference held",
  ourBook: "Our book",
} as const

const BEHIND_COLS = {
  maker: "Maker",
  behindTheirAwards: "Behind their awards",
  researcherTier: "Researcher tier",
  contactsOnFile: "Contacts on file",
  inventoryRead: "Inventory read",
  lastAwardSeen: "Last award seen",
} as const

const PART_COLS = {
  stockNumber: "Stock number",
  part: "Part",
  awards: "Awards",
  awardedValue: "Awarded value",
  makersApproved: "Makers approved",
  routeForANewSource: "Route for a new source",
  demandAhead: "Demand ahead",
  listedStock: "Listed stock",
} as const

const RIVAL_COLS = {
  company: "Company",
  awards: "Awards",
  awardedValue: "Awarded value",
  stockNumbers: "Stock numbers",
  alsoAnApprovedSource: "Also an approved source",
} as const

const STOCK_COLS = {
  firm: "Firm",
  stockNumbersListed: "Stock numbers listed",
  unitsListed: "Units listed",
  roleInThisExport: "Role in this export",
  ourBook: "Our book",
} as const

export function DedicatedPullView({ pull, cornerDigits }: { pull: DedicatedPull; cornerDigits: Set<string> }) {
  const { role, attribution, snapshot, bookSummary } = pull
  const subjectName = pull.subject.company ?? `CAGE ${pull.subject.cage}`

  return (
    <>
      {/* ---------------------------------------------------------------- the snapshot band */}
      <section className={styles.pullBand} aria-label="What this deep view is built from">
        <div className={styles.pullBandHead}>
          <StatusChip tone="accent">Dedicated pull</StatusChip>
          <span className={`mono ${styles.pullFile}`}>{snapshot.fileLabel}</span>
        </div>
        <p className={styles.pullBandBody}>
          This is a company-specific export somebody pulled once for {subjectName}, not a live feed. It does
          not update, and nothing that happened after its newest row is in it. The sheets carry no pull date,
          so the two dates that bracket it are stated rather than a freshness claim invented for the screen.
        </p>
        <dl className={styles.pullFacts}>
          <Fact
            label="Newest award row"
            value={snapshot.newestAwardIso ?? 'none readable'}
            note="the export was taken on or after this date"
          />
          <Fact
            label="File received here"
            value={snapshot.provenance.fileModifiedAt.slice(0, 10)}
            note="modification time on disk, the only receipt date we hold"
          />
          <Fact
            label="Forecast horizon"
            value={
              snapshot.forecastOpensMonth && snapshot.forecastClosesMonth
                ? `${snapshot.forecastOpensMonth} to ${snapshot.forecastClosesMonth}`
                : 'no readable forecast months'
            }
            note="the horizon opens the month after the pull, which is consistent with the bracket above"
          />
          <Fact
            label="Sheets read"
            value={snapshot.sheetRows.map((s) => `${s.sheet} ${count(s.rows)}`).join(' · ')}
            note="every row of all four, joined on the stock number"
          />
        </dl>
        <p className={styles.pullBandFoot}>
          Subject identified from the filename stem <span className="mono">{pull.identification.stem}</span>{' '}
          matching one company name in the file, {subjectName} (CAGE {pull.subject.cage}). Corroborated, not
          assumed: they hold {pct(pull.identification.awardRowShare)} of the award rows in the export
          {pull.identification.isPluralityAwardee ? ', more than any other company in it' : ''}. A file whose
          stem matches nothing, or matches two companies, gets no deep view at all.
        </p>
      </section>

      {/* ------------------------------------------------------------ what this company is */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>What {subjectName} actually is</h2>
        <p className={styles.cardSub}>
          Read this before the monopoly language anywhere else on the page. The government reference codes in
          this export settle it: a company that holds no design-control reference on the stock numbers it wins
          is not making them, it is buying them and reselling them.
        </p>
        <div className={styles.metricStrip}>
          <Metric n={count(role.awardRows)} label="awards won" hint={`${role.windowStartIso ?? 'unknown'} to ${role.windowEndIso ?? 'unknown'}`} />
          <Metric n={count(role.awardedNsns)} label="stock numbers won" hint="distinct items across those awards" />
          <MetricMoney amount={role.awardedValue} label="awarded value" hint="final price where the export carries one, else total price" />
          <Metric n={count(role.approvedSourceRows)} label="approved-source rows they hold" hint={`on ${count(role.approvedOnAwardedNsns)} of the ${count(role.awardedNsns)} they won`} />
          <Metric n={count(role.identityGradeRows)} label="design-control references" hint="the reference a maker holds on its own item" hot={role.identityGradeRows === 0} />
        </div>
        <p className={styles.verdict}>
          <StatusChip tone="verified">{role.verdict === 'dealer_pattern' ? 'Dealer pattern' : role.verdict === 'maker_pattern' ? 'Maker pattern' : 'Undetermined'}</StatusChip>{' '}
          <span>{role.basis}.</span>
        </p>
        {role.verdict === 'dealer_pattern' ? (
          <p className={styles.correction}>
            So the sole-source lens is pointed at the makers behind them, never at them. A wholesaler holding
            the only secondary reference on a stock number is not a cornered manufacturer, and reading it as
            one would be a confident category error on the company you asked about by name.
          </p>
        ) : null}
        <ul className={styles.factList}>
          <li>
            <b>{count(pull.acquisition.directFromManufacturerAwards)}</b> of their {count(role.awardRows)} awards
            were bought under an acquisition method that directs the buy to the manufacturer or a prime, and a
            reseller won them. That is the purchasing relationship this page is trying to name.
          </li>
          <li>
            <b>{count(pull.acquisition.singleBidAwards)}</b> of the {count(pull.acquisition.awardsWithOffersRead)}{' '}
            awards that carry an offers count went out with a single bidder.
          </li>
          <li>
            The Surplus cell is blank on <b>{count(pull.acquisition.surplusUnreadAwards)}</b> of their awards, so
            this export says nothing either way about whether they filled them from surplus. Unread, not no.
          </li>
        </ul>
      </section>

      {/* ------------------------------------------------------- the answer to the question */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Who they buy from</h2>
        <p className={styles.cardSub}>
          Their awards joined to the approved-source list, stock number by stock number. Where exactly one firm
          besides them is approved, the article can only have come from that firm and the dollars are theirs.
          Where several are approved, this export cannot say which one supplied, so those dollars are carried as
          a ceiling on named stock numbers and never as revenue. The two are never added together.
        </p>
        <div className={styles.metricStrip}>
          <Metric n={count(pull.makers.length)} label="makers behind their business" hint="distinct approved sources across the stock numbers they won" hot />
          <MetricMoney amount={attribution.singleMakerValue} label="traced to one maker" hint={`${count(attribution.singleMakerNsns)} stock numbers with a single approved source`} />
          <MetricMoney
            amount={attribution.severalMakerValueCeiling}
            prefix="up to"
            label="several makers possible"
            hint={`${count(attribution.severalMakerNsns)} stock numbers, attribution unresolved`}
          />
          <MetricMoney amount={attribution.noRecordValue} label="maker unknown" hint={`${count(attribution.noRecordNsns)} stock numbers with no approved-source row at all`} />
        </div>
        <Scrollable className={`${styles.tableWrap} ${rt.cards}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{MAKER_COLS.maker}</th>
                <th>{MAKER_COLS.tracedToThem}</th>
                <th>{MAKER_COLS.sharedWithOtherApprovedSources}</th>
                <th>{MAKER_COLS.referenceHeld}</th>
                <th>{MAKER_COLS.ourBook}</th>
              </tr>
            </thead>
            <tbody>
              {pull.makers.slice(0, MAKERS_SHOWN).map((m) => (
                <tr key={m.cage}>
                  <td data-label={MAKER_COLS.maker}>
                    <span className={styles.makerName}>{m.company ?? 'company name absent'}</span>
                    <span className={`mono ${styles.makerCage}`}>CAGE {m.cage}</span>
                    {m.sameNameCages.length > 0 ? (
                      <span className={styles.sameName}>
                        same name on {m.sameNameCages.length} other code{m.sameNameCages.length === 1 ? '' : 's'}
                        {' '}({m.sameNameCages.join(', ')}), not confirmed as one firm
                      </span>
                    ) : null}
                  </td>
                  <td data-label={MAKER_COLS.tracedToThem}>
                    {m.soleNsns.length > 0 ? (
                      <>
                        <Money amount={m.soleAwardedValue} provenance="measured" />
                        <span className={styles.cellNote}>
                          {count(m.soleNsns.length)} stock number{m.soleNsns.length === 1 ? '' : 's'}, only approved source
                        </span>
                      </>
                    ) : (
                      <span className={styles.cellAbsent}>never the only approved source</span>
                    )}
                  </td>
                  <td data-label={MAKER_COLS.sharedWithOtherApprovedSources}>
                    {m.sharedNsns.length > 0 ? (
                      <>
                        <span className={styles.ceilingPrefix}>up to</span>{' '}
                        <Money amount={m.sharedAwardedValueCeiling} provenance="measured" />
                        <span className={styles.cellNote}>
                          {count(m.sharedNsns.length)} stock number{m.sharedNsns.length === 1 ? '' : 's'} shared with other
                          approved sources. A ceiling, not their revenue.
                        </span>
                      </>
                    ) : (
                      <span className={styles.cellAbsent}>none</span>
                    )}
                  </td>
                  <td data-label={MAKER_COLS.referenceHeld}>
                    {m.holdsIdentityGradeReference ? (
                      <StatusChip tone="verified" srLabel="design control or source control reference, item identifying">
                        design control
                      </StatusChip>
                    ) : (
                      <StatusChip tone="idle" srLabel="secondary or informative reference only">
                        secondary only
                      </StatusChip>
                    )}
                  </td>
                  <td data-label={MAKER_COLS.ourBook}>
                    <BookCell book={m.book} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scrollable>
        <p className={styles.tableFoot}>
          Showing {count(Math.min(MAKERS_SHOWN, pull.makers.length))} of {count(pull.makers.length)}, ordered by
          the dollars that trace to them alone, then by their shared ceiling.
        </p>
      </section>

      {/* --------------------------------------------------- the join that makes it Monday */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Makers we already hold a way in to</h2>
        {pull.bookAvailable ? (
          <>
            <p className={styles.cardSub}>
              The makers above crossed against the operator&rsquo;s own supplier book. This is the half that turns
              a teardown into a call list: {count(bookSummary.contactable)} of the {count(bookSummary.makers)}{' '}
              firms behind this competitor&rsquo;s business already have a recorded phone number, email address or
              named contact in our book.
            </p>
            <div className={styles.metricStrip}>
              <Metric n={count(bookSummary.contactable)} label="with a way in" hint="a phone, an email or a named contact on file" hot />
              <Metric n={count(bookSummary.inBookNoChannel)} label="in the book, no channel" hint="we know the firm and hold no way to reach it" />
              <Metric n={count(bookSummary.notInBook)} label="not in the book" hint="unknown to us, which is not a statement about them" />
            </div>
            {pull.contactableMakers.length > 0 ? (
              <Scrollable className={`${styles.tableWrap} ${rt.cards}`}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{BEHIND_COLS.maker}</th>
                      <th>{BEHIND_COLS.behindTheirAwards}</th>
                      <th>{BEHIND_COLS.researcherTier}</th>
                      <th>{BEHIND_COLS.contactsOnFile}</th>
                      <th>{BEHIND_COLS.inventoryRead}</th>
                      <th>{BEHIND_COLS.lastAwardSeen}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pull.contactableMakers.map((m) => (
                      <tr key={m.cage}>
                        <td data-label={BEHIND_COLS.maker}>
                          <span className={styles.makerName}>{m.company ?? 'company name absent'}</span>
                          <span className={`mono ${styles.makerCage}`}>CAGE {m.cage}</span>
                        </td>
                        <td data-label={BEHIND_COLS.behindTheirAwards}>{behindLabel(m)}</td>
                        <td data-label={BEHIND_COLS.researcherTier}>
                          {m.book.state === 'contactable' ? (
                            <span className={styles.prior}>{m.book.tier ?? 'untiered'}{m.book.score != null ? ` · ${m.book.score}` : ''}</span>
                          ) : null}
                        </td>
                        <td data-label={BEHIND_COLS.contactsOnFile} className="mono">
                          {m.book.state === 'contactable'
                            ? `${count(m.book.contacts)}${m.book.hasEmail ? ' · email' : ''}${m.book.hasPhone ? ' · phone' : ''}`
                            : ''}
                        </td>
                        <td data-label={BEHIND_COLS.inventoryRead}>
                          {m.book.state === 'contactable' ? (
                            <span className={styles.prior}>{m.book.holdsInventory ?? 'not researched'}</span>
                          ) : null}
                        </td>
                        <td data-label={BEHIND_COLS.lastAwardSeen} className="mono">
                          {m.book.state === 'contactable' ? (m.book.lastAwardedAt ?? 'not recorded') : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scrollable>
            ) : (
              <p className={styles.empty}>
                None of the {count(bookSummary.makers)} makers behind this competitor appear in the supplier book
                with a recorded way in. That is a gap in our book, not a finding about them.
              </p>
            )}
            <p className={styles.caveat}>
              Two things this table is not. The tier, the score and the inventory read are the researcher&rsquo;s
              PRIOR, carried through unchanged and never recomputed here. And the book is a researched list of
              firms that went award silent, not a directory of the market, so a maker missing from it is a firm we
              have not researched. It is not evidence that they will not sell to us, and it is not evidence that
              they will. Whether they sell to a dealer is a phone call, and this product will not pretend
              otherwise.
            </p>
          </>
        ) : (
          <p className={styles.empty}>
            The supplier book is not loaded, so no maker on this page can be checked against it.{' '}
            {pull.bookReason ?? ''} Every maker above therefore reads as unknown to us rather than absent from our
            book, which are different facts.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------- their stock numbers */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Every stock number they won</h2>
        <p className={styles.cardSub}>
          Their award history, one row per item, with the makers approved for it and what the acquisition codes
          on their newest award say about how a new source could reach it. The route reading comes from the
          government codebook and abstains where a code is missing rather than guessing at an answer.
        </p>
        <Scrollable className={`${styles.tableWrap} ${rt.cards}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{PART_COLS.stockNumber}</th>
                <th>{PART_COLS.part}</th>
                <th className={styles.numCol}>{PART_COLS.awards}</th>
                <th>{PART_COLS.awardedValue}</th>
                <th>{PART_COLS.makersApproved}</th>
                <th>{PART_COLS.routeForANewSource}</th>
                <th>{PART_COLS.demandAhead}</th>
                <th>{PART_COLS.listedStock}</th>
              </tr>
            </thead>
            <tbody>
              {pull.parts.slice(0, PARTS_SHOWN).map((p) => (
                <PartRow key={p.nsn} part={p} isCorner={cornerDigits.has(p.niin) || cornerDigits.has(p.nsn.replace(/[^0-9]/g, ''))} />
              ))}
            </tbody>
          </table>
        </Scrollable>
        <p className={styles.tableFoot}>
          Showing {count(Math.min(PARTS_SHOWN, pull.parts.length))} of {count(pull.parts.length)}, largest awarded
          value first. A <StatusChip tone="accent">Corner</StatusChip> tag means it is also one of our candidate
          corners; open it for the dossier.
        </p>
      </section>

      {/* --------------------------------------------------------------------- the rivals */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Who else wins these</h2>
        <p className={styles.cardSub}>
          Every other company that won an award on one of their stock numbers, from the same export. Some of
          these are the makers themselves bidding direct, which is marked, and the rest are dealers competing for
          the same items.
        </p>
        <Scrollable className={`${styles.tableWrap} ${rt.cards}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{RIVAL_COLS.company}</th>
                <th className={styles.numCol}>{RIVAL_COLS.awards}</th>
                <th>{RIVAL_COLS.awardedValue}</th>
                <th className={styles.numCol}>{RIVAL_COLS.stockNumbers}</th>
                <th>{RIVAL_COLS.alsoAnApprovedSource}</th>
              </tr>
            </thead>
            <tbody>
              {pull.rivals.slice(0, RIVALS_SHOWN).map((r) => (
                <tr key={r.cage}>
                  <td data-label={RIVAL_COLS.company}>
                    <span className={styles.makerName}>{r.company ?? 'company name absent'}</span>
                    <span className={`mono ${styles.makerCage}`}>CAGE {r.cage}</span>
                  </td>
                  <td data-label={RIVAL_COLS.awards} className={`mono ${styles.numCol}`}>{count(r.awards)}</td>
                  <td data-label={RIVAL_COLS.awardedValue}>
                    <Money amount={r.awardedValue} provenance="measured" />
                  </td>
                  <td data-label={RIVAL_COLS.stockNumbers} className={`mono ${styles.numCol}`}>{count(r.nsns)}</td>
                  <td data-label={RIVAL_COLS.alsoAnApprovedSource}>
                    {r.isApprovedSource ? (
                      <StatusChip tone="verified">maker bidding direct</StatusChip>
                    ) : (
                      <StatusChip tone="idle">reseller</StatusChip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scrollable>
        <p className={styles.tableFoot}>
          Showing {count(Math.min(RIVALS_SHOWN, pull.rivals.length))} of {count(pull.rivals.length)}, largest
          awarded value first.
        </p>
      </section>

      {/* ------------------------------------------------------------------ the spot market */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Who lists stock on these today</h2>
        <p className={styles.cardSub}>
          The availability sheet, which is the RESELLER book and not a maker list:{' '}
          {count(pull.spotMarket.firmsAlsoApprovedSource)} of these {count(pull.spotMarket.firms)} firms{' '}
          {pull.spotMarket.firmsAlsoApprovedSource === 1 ? 'is' : 'are'} also an approved source anywhere in this
          export. These are self-reported listings. Read them as material
          somebody says they hold, never as confirmed stock, and read a stock number missing from this sheet as
          unknown rather than as nobody having it.
        </p>
        <div className={styles.metricStrip}>
          <Metric n={count(pull.spotMarket.firms)} label="firms listing" hint={`${count(pull.spotMarket.rows)} listings over ${count(pull.spotMarket.nsns)} stock numbers`} />
          <Metric n={count(pull.spotMarket.unitsListed)} label="units listed" hint={`${count(pull.spotMarket.zeroQuantityRows)} listings carry a quantity of zero, which is a published zero`} />
          <Metric n={count(pull.spotMarket.firmsAlsoApprovedSource)} label="also an approved source" hint="everyone else here is holding material, not making it" />
        </div>
        <Scrollable className={`${styles.tableWrap} ${rt.cards}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{STOCK_COLS.firm}</th>
                <th className={styles.numCol}>{STOCK_COLS.stockNumbersListed}</th>
                <th className={styles.numCol}>{STOCK_COLS.unitsListed}</th>
                <th>{STOCK_COLS.roleInThisExport}</th>
                <th>{STOCK_COLS.ourBook}</th>
              </tr>
            </thead>
            <tbody>
              {pull.spotMarket.holders.slice(0, HOLDERS_SHOWN).map((h) => (
                <tr key={h.cage}>
                  <td data-label={STOCK_COLS.firm}>
                    <span className={styles.makerName}>{h.company ?? 'company name absent'}</span>
                    <span className={`mono ${styles.makerCage}`}>CAGE {h.cage}</span>
                  </td>
                  <td data-label={STOCK_COLS.stockNumbersListed} className={`mono ${styles.numCol}`}>{count(h.nsns)}</td>
                  <td data-label={STOCK_COLS.unitsListed} className={`mono ${styles.numCol}`}>{count(h.unitsListed)}</td>
                  <td data-label={STOCK_COLS.roleInThisExport}>
                    {h.isApprovedSource ? (
                      <StatusChip tone="verified">approved source</StatusChip>
                    ) : (
                      <StatusChip tone="idle">holds material only</StatusChip>
                    )}
                  </td>
                  <td data-label={STOCK_COLS.ourBook}>
                    {pull.bookAvailable ? (
                      h.inBook ? (
                        <StatusChip tone="accent">in our book</StatusChip>
                      ) : (
                        <span className={styles.cellAbsent}>not in our book</span>
                      )
                    ) : (
                      <span className={styles.cellAbsent}>book not loaded</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scrollable>
        <p className={styles.tableFoot}>
          Showing {count(Math.min(HOLDERS_SHOWN, pull.spotMarket.holders.length))} of{' '}
          {count(pull.spotMarket.holders.length)}, most stock numbers listed first.
        </p>
      </section>

      {/* ---------------------------------------------------------------------- the demand */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Demand ahead on their items</h2>
        <p className={styles.cardSub}>
          The forecast sheet from the same export, covering {count(pull.forecast.nsns)} stock numbers, of which{' '}
          {count(pull.forecast.nsnsAlsoAwarded)} are ones they have already won. It was published for the horizon
          below and has not moved since the pull.
        </p>
        <div className={styles.metricStrip}>
          <Metric n={count(pull.forecast.unitsForecast)} label="units forecast" hint={`across ${count(pull.forecast.rows)} monthly rows`} />
          <Metric n={count(pull.forecast.zeroQuantityRows)} label="rows published as zero" hint="a published zero is a forecast, not a gap, and is counted separately" />
          <Metric
            n={count(pull.forecast.nsns)}
            label="stock numbers forecast"
            hint={pull.forecast.unparsedDateRows > 0 ? `${count(pull.forecast.unparsedDateRows)} rows carry a month we could not read` : 'every row carried a readable month'}
          />
        </div>
        <ul className={styles.factList}>
          {pull.forecast.supplyChains.map((s) => (
            <li key={s.chain}>
              <b>{s.chain}</b>: {count(s.rows)} forecast rows.
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

/* ------------------------------------------------------------------------------------ */
/* SMALL PIECES                                                                           */
/* ------------------------------------------------------------------------------------ */

function behindLabel(m: MakerRow): string {
  if (m.soleNsns.length > 0) {
    return `${count(m.soleNsns.length)} stock number${m.soleNsns.length === 1 ? '' : 's'} traced to them alone`
  }
  return `${count(m.sharedNsns.length)} stock number${m.sharedNsns.length === 1 ? '' : 's'}, shared with other approved sources`
}

function BookCell({ book }: { book: BookMatch }) {
  if (book.state === 'book_unavailable') {
    return <span className={styles.cellAbsent}>book not loaded</span>
  }
  if (book.state === 'not_in_book') {
    return <span className={styles.cellAbsent}>not researched by us</span>
  }
  if (book.state === 'in_book_no_channel') {
    return <StatusChip tone="idle">in book, no channel</StatusChip>
  }
  return (
    <>
      <StatusChip tone="accent">we have a way in</StatusChip>
      <span className={styles.cellNote}>
        {book.hasEmail ? 'email' : null}
        {book.hasEmail && book.hasPhone ? ' and ' : null}
        {book.hasPhone ? 'phone' : null}
        {book.contacts > 0 ? `${book.hasEmail || book.hasPhone ? ', ' : ''}${count(book.contacts)} named contact${book.contacts === 1 ? '' : 's'}` : null}
      </span>
    </>
  )
}

function PartRow({ part, isCorner }: { part: SubjectPart; isCorner: boolean }) {
  return (
    <tr>
      <td data-label={PART_COLS.stockNumber} className="mono">
        {isCorner ? (
          <Link href={`/corner/${part.nsn.replace(/[^0-9]/g, '')}` as never} className={styles.nsnLink}>
            {part.nsn}
          </Link>
        ) : (
          <span className={styles.nsnPlain}>{part.nsn}</span>
        )}
        {isCorner ? <StatusChip tone="accent">Corner</StatusChip> : null}
      </td>
      <td data-label={PART_COLS.part} className={styles.partCell}>{part.description || 'no description in the export'}</td>
      <td data-label={PART_COLS.awards} className={`mono ${styles.numCol}`}>{count(part.awards)}</td>
      <td data-label={PART_COLS.awardedValue}>
        <Money amount={part.awardedValue} provenance="measured" />
        {part.awardsWithUnreadValue > 0 ? (
          <span className={styles.cellNote}>
            {count(part.awardsWithUnreadValue)} award{part.awardsWithUnreadValue === 1 ? '' : 's'} carried no
            readable price and {part.awardsWithUnreadValue === 1 ? 'is' : 'are'} not in this figure
          </span>
        ) : null}
      </td>
      <td data-label={PART_COLS.makersApproved} className={styles.makerCell}>
        {part.attribution === 'no_approved_source_recorded' ? (
          <span className={styles.cellAbsent}>no approved-source row in this export</span>
        ) : (
          <>
            <span>
              {part.makers
                .slice(0, 2)
                .map((m) => m.company ?? m.cage)
                .join(', ')}
              {part.makers.length > 2 ? ` and ${count(part.makers.length - 2)} more` : ''}
            </span>
            <span className={styles.cellNote}>
              {part.attribution === 'single_approved_source'
                ? 'the only approved source, so the article came from them'
                : `${count(part.makers.length)} approved sources, so which one supplied is not in this file`}
            </span>
          </>
        )}
      </td>
      <td data-label={PART_COLS.routeForANewSource}>
        {part.route.unknown ? (
          <span className={styles.cellAbsent}>codes incomplete, not determined</span>
        ) : (
          <>
            <span>{ACCESS_WORDS[part.route.access] ?? part.route.access}</span>
            {part.route.sourceApprovalEligible ? (
              <span className={styles.cellNote}>source approval is available on this one</span>
            ) : null}
          </>
        )}
      </td>
      <td data-label={PART_COLS.demandAhead} className="mono">
        {part.forecast ? (
          `${count(part.forecast.quantity)} units / ${count(part.forecast.rows)} months`
        ) : (
          <span className={styles.cellAbsent}>not forecast</span>
        )}
      </td>
      <td data-label={PART_COLS.listedStock} className="mono">
        {part.spot ? (
          `${count(part.spot.holders)} listing${part.spot.holders === 1 ? '' : 's'} / ${count(part.spot.quantity)} units`
        ) : (
          <span className={styles.cellAbsent}>none listed</span>
        )}
      </td>
    </tr>
  )
}

function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>
        <span className="mono">{value}</span>
        <span className={styles.factNote}>{note}</span>
      </dd>
    </div>
  )
}

function Metric({ n, label, hint, hot }: { n: string; label: string; hint: string; hot?: boolean }) {
  return (
    <div className={`${styles.metric} ${hot ? styles.metricHot : ''}`}>
      <span className={styles.metricN}>{n}</span>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricHint}>{hint}</span>
    </div>
  )
}

/**
 * `prefix` exists for one reason: a CEILING and an attributable figure must not read alike.
 * Both are measured sums, so `Money` labels both "measured" and is right to, but the strip
 * would otherwise put an upper bound beside a traced figure at identical confidence and
 * invite an operator to add them. The table carries the same "up to" for the same reason.
 */
function MetricMoney({ amount, label, hint, prefix }: { amount: number; label: string; hint: string; prefix?: string }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricMoney}>
        {prefix ? <span className={styles.ceilingPrefix}>{prefix} </span> : null}
        <Money amount={amount} provenance="measured" emphasis />
      </span>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricHint}>{hint}</span>
    </div>
  )
}
