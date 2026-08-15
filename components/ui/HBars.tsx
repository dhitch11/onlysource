import * as React from 'react'
import styles from './hbars.module.css'

/**
 * HORIZONTAL BAR CHART — categorical magnitude, one hue.
 *
 * Counts of real things (corners per supply chain, corners per score band). Magnitude is length;
 * there is one series, so there is one hue (brass), never a rainbow. The value is direct-labelled at
 * the end of each bar, so no axis or gridline is needed and none is drawn. An empty dataset renders
 * an honest "nothing to chart" rather than an empty frame.
 */
export type HBar = { label: string; value: number }

export function HBars({
  data,
  emptyNote = 'Nothing to chart here yet.',
  valueSuffix = '',
}: {
  data: HBar[]
  emptyNote?: string
  valueSuffix?: string
}) {
  const rows = data.filter((d) => Number.isFinite(d.value))
  if (rows.length === 0) return <p className={styles.empty}>{emptyNote}</p>
  const max = Math.max(...rows.map((r) => r.value), 1)

  return (
    <div className={styles.chart} role="table" aria-label="Bar chart">
      {rows.map((r) => (
        <div key={r.label} className={styles.row} role="row">
          <span className={styles.label} role="rowheader" title={r.label}>
            {r.label}
          </span>
          <span className={styles.track} role="cell">
            <span
              className={styles.bar}
              style={{ width: `${Math.max((r.value / max) * 100, 1.5)}%` }}
            />
          </span>
          <span className={styles.value} role="cell">
            {r.value.toLocaleString()}
            {valueSuffix}
          </span>
        </div>
      ))}
    </div>
  )
}
