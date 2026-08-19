import type { Metadata } from 'next'
import Link from 'next/link'
import { requireGateSession } from '@/lib/session/require-gate'
import { resolveDataRoot } from '@/lib/data-root'
import { buildCompetitorCatalogs, type CompetitorPart } from '@/lib/intelligence/competitor/catalog'
import { buildDedicatedPulls } from '@/lib/intelligence/competitor/rural-route'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { StatusChip } from '@/components/ui/StatusChip'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { Scrollable } from '@/components/ui/Scrollable'
import { CompetitorPicker } from './CompetitorPicker'
import { DedicatedPullView } from './DedicatedPullView'
import styles from './competitor.module.css'
import rt from '@/components/ui/responsive-table.module.css'

export const metadata: Metadata = { title: 'Competitor teardown · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

const SHOWN = 60

/**
 * COMPETITOR TEARDOWN, IN TWO DEPTHS THAT ARE NEVER ALLOWED TO LOOK ALIKE.
 *
 * THE GENERIC TEARDOWN is derived for every company in the parts exports from one sheet, the
 * approved-source list. It answers "what is this company approved to make and who else is".
 * That is a real answer and it is a thin one.
 *
 * THE DEDICATED PULL exists only where we hold a company-specific export: four sheets, the
 * award history, the approved sources, the listed material and the demand forecast, joined to
 * the operator's own supplier book. It answers the question a customer actually asked, which
 * is who is behind this competitor's resales and which of those makers we can already reach.
 *
 * The two are banded, titled and worded differently on purpose. A page that quietly shows a
 * deep view for one company and a shallow view for thirty-nine others, in the same chrome,
 * teaches the operator that the shallow ones are complete. See the note on the generic
 * section below for the second half of that: for a company the deep pull reads as a DEALER,
 * the sole-source language is corrected here rather than left to be read as a monopoly.
 */
const PARTS_COLS = {
  stockNumber: "Stock number",
  part: "Part",
  partNumber: "Part number",
  amsc: "AMSC",
  // The fifth column is one of two, chosen by `showRivals`. Two keys rather than one, so the
  // header and the cell that actually renders always read the SAME string.
  rivals: "Rivals",
  sources: "Sources",
} as const

export default async function CompetitorPage({
  searchParams,
}: {
  searchParams: Promise<{ cage?: string }>
}) {
  await requireGateSession('/competitor')
  const { cage: cageParam } = await searchParams

  if (!resolveDataRoot().present) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Intelligence</p>
          <h1 className={styles.h1}>Competitor teardown</h1>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>Today&rsquo;s data hasn&rsquo;t loaded yet</h2>
          <p>This teardown is built from the government parts export. It appears the moment the feed is here.</p>
        </div>
      </main>
    )
  }

  const catalogs = buildCompetitorCatalogs()
  if (!catalogs.ok) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Intelligence</p>
          <h1 className={styles.h1}>Competitor teardown</h1>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>No competitor loaded yet</h2>
          <p>
            Drop a <code>&lt;company&gt;-parts.xlsx</code> export into the data folder and this pulls it apart
            automatically. {catalogs.reason}
          </p>
        </div>
      </main>
    )
  }

  const cornerDigits = new Set(
    buildAllDatasets()
      .cornerMap.rows.filter((r) => r.soleSource && r.silentSourceCount > 0)
      .map((r) => r.nsn.replace(/[^0-9]/g, '')),
  )
  const co =
    catalogs.competitors.find((c) => c.cage === (cageParam ?? '').toUpperCase()) ??
    catalogs.competitors.find((c) => c.cage === catalogs.defaultCage) ??
    catalogs.competitors[0]!

  // The deep layer. Absent for every company we hold no company-specific export for, which is
  // the ordinary case and is said out loud rather than implied by a thinner page.
  const pulls = buildDedicatedPulls()
  const pull = pulls.pulls.get(co.cage) ?? null
  const deepCages = new Set(pulls.pulls.keys())
  const deepCompanies = [...pulls.pulls.values()].map((p) => ({
    cage: p.subject.cage,
    name: p.subject.company ?? `CAGE ${p.subject.cage}`,
  }))

  const pickerOptions = catalogs.competitors.map((c) => ({
    cage: c.cage,
    label: c.company ?? `CAGE ${c.cage}`,
    parts: c.summary.parts,
    deep: deepCages.has(c.cage),
  }))

  // A dealer holding the only SECONDARY reference on a stock number is not a cornered maker.
  // The deep pull measures that distinction from the government reference codes, so where it
  // says dealer, the generic section below drops the monopoly wording rather than repeating it.
  const dealerPattern = pull?.role.verdict === 'dealer_pattern'

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Intelligence · competitor teardown</p>
        <div className={styles.headRow}>
          <h1 className={styles.h1}>{co.company ?? `CAGE ${co.cage}`}</h1>
          {/* The manufacturer-view explainer, written for exactly this page ("every position
              behind one dead source at once") and mounted nowhere until the census. */}
          <ExplainButton helpId="monopoly.inversion" />
          {pickerOptions.length > 1 ? <CompetitorPicker options={pickerOptions} current={co.cage} /> : null}
        </div>
        {/* A div, not a p: the explainer's popover renders a <div>, and a div inside a <p>
            is auto-closed by the HTML parser, which shipped as a React #418 hydration error. */}
        <div className={styles.sub}>
          {pull ? (
            <>
              We hold a dedicated export for <b>{co.company ?? `CAGE ${co.cage}`}</b> (CAGE {co.cage}
              <ExplainButton helpId="monopoly.cage" size="sm" />), so this page goes past the approved-source
              list into their award history, who is behind it, and which of those makers we can already reach.
            </>
          ) : (
            <>
              Every stock number <b>{co.company ?? `CAGE ${co.cage}`}</b> (CAGE {co.cage}
              <ExplainButton helpId="monopoly.cage" size="sm" />) is approved to make, taken apart.
              Where they are the only source, they hold a private monopoly. Where others are approved
              too, they have to fight for it.
            </>
          )}
        </div>
      </header>

      {pull ? (
        <DedicatedPullView pull={pull} cornerDigits={cornerDigits} />
      ) : (
        <ShallowNotice
          company={co.company ?? `CAGE ${co.cage}`}
          deepCompanies={deepCompanies}
          skipped={pulls.skipped}
        />
      )}

      <section className={styles.layerBreak} aria-label="What the generic layer is">
        <h2 className={styles.layerTitle}>The generic layer, derived for every company</h2>
        <p className={styles.layerBody}>
          {pull ? (
            <>
              Everything above came from the dedicated export. Everything below is the shallow teardown this
              product derives for all {catalogs.competitors.length} companies in the parts files, from the
              approved-source sheet alone. For {co.company ?? `CAGE ${co.cage}`} it reads{' '}
              {co.summary.parts} reference row{co.summary.parts === 1 ? '' : 's'}, which is their reference
              footprint and not the size of their business.
            </>
          ) : (
            <>
              This is the layer available for all {catalogs.competitors.length} companies in the parts files. It
              is built from the approved-source sheet alone: no award history, no pricing, no supplier-book
              join, and no way to say who is behind what they sell.
            </>
          )}
        </p>
      </section>

      <section className={styles.metricStrip} aria-label="Teardown totals">
        <Metric
          n={co.summary.parts}
          label={dealerPattern ? 'reference rows they hold' : 'parts they can make'}
          hint={dealerPattern ? 'stock numbers listing them anywhere on the approved-source sheet' : 'stock numbers they are an approved source for'}
        />
        <Metric
          n={co.summary.soleSource}
          label={dealerPattern ? 'where theirs is the only row' : 'only they can make'}
          hint={dealerPattern ? 'not a manufacturing monopoly, see the correction below' : 'a private monopoly on each'}
          hot={!dealerPattern}
        />
        <Metric n={co.summary.competed} label="they compete for" hint="others are approved too" />
        <Metric n={co.summary.distinctRivals} label="rival companies" hint="approved on at least one shared part" />
      </section>

      <Section
        title={
          dealerPattern
            ? `Where ${co.company ?? 'they'} hold the only listed reference`
            : `Where ${co.company ?? 'they'} are the only source`
        }
        blurb={
          dealerPattern
            ? 'Read as a monopoly this would be wrong, and the deep view above measures why: they hold no design-control reference on any stock number they won, so these rows are a reseller appearing on the reference list, not a maker cornering an item.'
            : 'No one else is approved to make these. That is a monopoly you cannot enter today, but the day they go award-silent it becomes a corner. These are the ones to watch.'
        }
        parts={co.parts.filter((p) => p.soleSource)}
        cornerDigits={cornerDigits}
      />

      <Section
        title="Where they compete"
        blurb="Several companies are approved for these, so the field is open. Sorted by how few rivals there are, because the thinnest fields are the easiest to win."
        parts={co.parts.filter((p) => !p.soleSource)}
        cornerDigits={cornerDigits}
        showRivals
      />
    </main>
  )
}

/**
 * The honest label on the shallow case. It names what is missing and which companies do have
 * the deep view, so a thin page is never mistaken for a complete one.
 */
function ShallowNotice({
  company,
  deepCompanies,
  skipped,
}: {
  company: string
  deepCompanies: Array<{ cage: string; name: string }>
  skipped: DedicatedPullIndexSkip[]
}) {
  return (
    <section className={styles.shallowBand}>
      <div className={styles.pullBandHead}>
        <StatusChip tone="idle">Generic teardown only</StatusChip>
      </div>
      <p className={styles.pullBandBody}>
        We hold no company-specific export for {company}, so this page can only show what the approved-source
        sheet says. It cannot say what they have won, what they were paid, who supplies them, or who we could
        buy from instead.{' '}
        {deepCompanies.length > 0 ? (
          <>
            A dedicated pull exists for{' '}
            {deepCompanies.map((d, i) => (
              <span key={d.cage}>
                {i > 0 ? ', ' : ''}
                <Link href={`/competitor?cage=${d.cage}` as never} className={styles.nsnLink}>
                  {d.name}
                </Link>
              </span>
            ))}
            . Open one to see the difference between the two depths.
          </>
        ) : (
          <>No dedicated pull is loaded for any company yet.</>
        )}
      </p>
      {skipped.length > 0 ? (
        <ul className={styles.factList}>
          {skipped.map((s) => (
            <li key={s.file}>
              <span className="mono">{s.file}</span> was not read as a dedicated pull: {s.reason}.
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

type DedicatedPullIndexSkip = ReturnType<typeof buildDedicatedPulls>['skipped'][number]

function Metric({ n, label, hint, hot }: { n: number; label: string; hint: string; hot?: boolean }) {
  return (
    <div className={`${styles.metric} ${hot ? styles.metricHot : ''}`}>
      <span className={styles.metricN}>{n.toLocaleString()}</span>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricHint}>{hint}</span>
    </div>
  )
}

function Section({
  title,
  blurb,
  parts,
  cornerDigits,
  showRivals = false,
}: {
  title: string
  blurb: string
  parts: CompetitorPart[]
  cornerDigits: Set<string>
  showRivals?: boolean
}) {
  if (parts.length === 0) {
    return (
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{title}</h2>
        <p className={styles.empty}>None in this class for this company.</p>
      </section>
    )
  }
  const shown = parts.slice(0, SHOWN)
  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>{title}</h2>
      <p className={styles.cardSub}>{blurb}</p>
      <Scrollable className={`${styles.tableWrap} ${rt.cards}`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{PARTS_COLS.stockNumber}</th>
              <th>{PARTS_COLS.part}</th>
              <th>{PARTS_COLS.partNumber}</th>
              <th>{PARTS_COLS.amsc}</th>
              {showRivals ? <th>{PARTS_COLS.rivals}</th> : <th className={styles.numCol}>{PARTS_COLS.sources}</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const isCorner = cornerDigits.has(p.niin) || cornerDigits.has(p.nsn.replace(/[^0-9]/g, ''))
              return (
                <tr key={p.nsn}>
                  <td data-label={PARTS_COLS.stockNumber} className="mono">
                    {isCorner ? (
                      <Link href={`/corner/${p.nsn.replace(/[^0-9]/g, '')}` as never} className={styles.nsnLink}>
                        {p.nsn}
                      </Link>
                    ) : (
                      <span className={styles.nsnPlain}>{p.nsn}</span>
                    )}
                    {isCorner ? <StatusChip tone="accent">Corner</StatusChip> : null}
                  </td>
                  <td data-label={PARTS_COLS.part} className={styles.partCell} title={p.description}>
                    {p.description || '—'}
                  </td>
                  <td data-label={PARTS_COLS.partNumber} className={`mono ${styles.pn}`}>{p.partNumber ?? '—'}</td>
                  <td data-label={PARTS_COLS.amsc} className="mono">{p.amsc ?? '—'}</td>
                  {showRivals ? (
                    <td data-label={PARTS_COLS.rivals} className={styles.rivalCell} title={p.otherSources.map((o) => o.company ?? o.cage).join(', ')}>
                      {p.otherSources
                        .slice(0, 2)
                        .map((o) => o.company ?? o.cage)
                        .join(', ')}
                      {p.otherSources.length > 2 ? ` +${p.otherSources.length - 2}` : ''}
                    </td>
                  ) : (
                    <td data-label={PARTS_COLS.sources} className={`mono ${styles.numCol}`}>{p.sourceCount}</td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </Scrollable>
      <p className={styles.tableFoot}>
        Showing {shown.length.toLocaleString()} of {parts.length.toLocaleString()}. A{' '}
        <StatusChip tone="accent">Corner</StatusChip> tag means it is also one of our candidate corners; open it for the dossier.
      </p>
    </section>
  )
}
