import * as React from 'react'
import styles from './route-loading.module.css'

/**
 * ROUTE LOADING — the branded skeleton shown while a heavy screen is being built on the server.
 *
 * The flagship screens read and parse large government files, so on a cold hit or a navigation the
 * server takes a moment. This is what fills that moment: never a blank page, never a bare spinner.
 * It names the screen and the real work in plain English, animates a calm build-up, and lays down
 * shimmer blocks in the rough shape of what is coming, so the wait reads as "being built," not
 * "broken." Pure CSS, no client JavaScript. Reduced-motion stills the shimmer.
 */
export function RouteLoading({
  title,
  subtitle,
  shape = 'table',
}: {
  title: string
  subtitle: string
  shape?: 'table' | 'dossier' | 'cards'
}) {
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div className={styles.header}>
        <div className={styles.bars} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className={styles.headText}>
          <p className={styles.title}>{title}</p>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
      </div>

      {shape === 'cards' ? (
        <div className={styles.cardGrid} aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={styles.skelCard} />
          ))}
        </div>
      ) : null}

      {shape === 'dossier' ? (
        <div className={styles.dossier} aria-hidden="true">
          <div className={`${styles.skel} ${styles.chartFrame}`} />
          <div className={styles.legGrid}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`${styles.skel} ${styles.leg}`} />
            ))}
          </div>
        </div>
      ) : null}

      {shape === 'table' ? (
        <div className={styles.table} aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`${styles.skel} ${styles.rowSkel}`} style={{ opacity: 1 - i * 0.09 }} />
          ))}
        </div>
      ) : null}

      <span className="vh">{title}. {subtitle}</span>
    </div>
  )
}
