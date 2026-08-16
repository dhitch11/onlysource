import type { Metadata } from 'next'
import Link from 'next/link'
import { requireGateSession } from '@/lib/session/require-gate'
import { resolveDataRoot } from '@/lib/data-root'
import { buildCompetitorCatalogs, type CompetitorPart } from '@/lib/intelligence/competitor/catalog'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { StatusChip } from '@/components/ui/StatusChip'
import styles from './competitor.module.css'

export const metadata: Metadata = { title: 'Competitor teardown · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

const SHOWN = 60

/**
 * COMPETITOR TEARDOWN.
 *
 * Pick a company apart. Every stock number it is approved to make, split into the ones only it can
 * make (its private monopolies, the ones you want if it ever goes quiet) and the ones it fights over.
 * Every source pairing is a government record; a stock number that is also one of our candidate
 * corners links straight into its dossier.
 */
export default async function CompetitorPage() {
  await requireGateSession('/competitor')

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
  const co = catalogs.competitors[0]! // one loaded today; the surface generalises to many

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Intelligence · competitor teardown</p>
        <h1 className={styles.h1}>{co.company ?? 'Competitor'}</h1>
        <p className={styles.sub}>
          Every stock number <b>{co.company ?? `CAGE ${co.cage}`}</b> (CAGE {co.cage}) is approved to make,
          taken apart. Where they are the only source, they hold a private monopoly. Where others are
          approved too, they have to fight for it.
        </p>
      </header>

      <section className={styles.metricStrip} aria-label="Teardown totals">
        <Metric n={co.summary.parts} label="parts they can make" hint="stock numbers they are an approved source for" />
        <Metric n={co.summary.soleSource} label="only they can make" hint="a private monopoly on each" hot />
        <Metric n={co.summary.competed} label="they compete for" hint="others are approved too" />
        <Metric n={co.summary.distinctRivals} label="rival companies" hint="approved on at least one shared part" />
      </section>

      <Section
        title={`Where ${co.company ?? 'they'} are the only source`}
        blurb="No one else is approved to make these. That is a monopoly you cannot enter today, but the day they go award-silent it becomes a corner. These are the ones to watch."
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
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Stock number</th>
              <th>Part</th>
              <th>Part number</th>
              <th>AMSC</th>
              {showRivals ? <th>Rivals</th> : <th className={styles.numCol}>Sources</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const isCorner = cornerDigits.has(p.niin) || cornerDigits.has(p.nsn.replace(/[^0-9]/g, ''))
              return (
                <tr key={p.nsn}>
                  <td className="mono">
                    {isCorner ? (
                      <Link href={`/corner/${p.nsn.replace(/[^0-9]/g, '')}` as never} className={styles.nsnLink}>
                        {p.nsn}
                      </Link>
                    ) : (
                      <span className={styles.nsnPlain}>{p.nsn}</span>
                    )}
                    {isCorner ? <StatusChip tone="urgent">Corner</StatusChip> : null}
                  </td>
                  <td className={styles.partCell} title={p.description}>
                    {p.description || '—'}
                  </td>
                  <td className={`mono ${styles.pn}`}>{p.partNumber ?? '—'}</td>
                  <td className="mono">{p.amsc ?? '—'}</td>
                  {showRivals ? (
                    <td className={styles.rivalCell} title={p.otherSources.map((o) => o.company ?? o.cage).join(', ')}>
                      {p.otherSources
                        .slice(0, 2)
                        .map((o) => o.company ?? o.cage)
                        .join(', ')}
                      {p.otherSources.length > 2 ? ` +${p.otherSources.length - 2}` : ''}
                    </td>
                  ) : (
                    <td className={`mono ${styles.numCol}`}>{p.sourceCount}</td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.tableFoot}>
        Showing {shown.length.toLocaleString()} of {parts.length.toLocaleString()}. A{' '}
        <StatusChip tone="urgent">Corner</StatusChip> tag means it is also one of our candidate corners; open it for the dossier.
      </p>
    </section>
  )
}
