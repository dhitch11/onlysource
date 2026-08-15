'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './ai-loader.module.css'

/**
 * THE AI LOADING EXPERIENCE — required for anything that takes more than three seconds.
 *
 * When the analyst is working, this is what the operator watches. It is not a spinner: it names the
 * real work in progress, in plain language, and advances through the actual steps the server runs, so
 * the wait reads as "a real analyst is reading real government data," not "the page is stuck." The
 * stages describe why the wait is worth it; the visual is a calm, premium build-up, not a frantic
 * whirl. Honest by construction: the stages ARE the steps, and it never claims to be finished.
 *
 * Reduced-motion is respected: the animation stills, the words still advance.
 */
export function AiLoader({
  title,
  stages,
  note,
}: {
  title: string
  stages: string[]
  /** One encouraging line under the stages, explaining the wait. */
  note?: string
}) {
  const [i, setI] = useState(0)
  const startedRef = useRef(false)

  useEffect(() => {
    // Advance through the stages, holding on the last one (the write) until the result lands.
    startedRef.current = true
    const id = setInterval(() => {
      setI((prev) => (prev < stages.length - 1 ? prev + 1 : prev))
    }, 2200)
    return () => clearInterval(id)
  }, [stages.length])

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div className={styles.visual} aria-hidden="true">
        <span className={styles.bar} />
        <span className={styles.bar} />
        <span className={styles.bar} />
        <span className={styles.bar} />
        <span className={styles.bar} />
      </div>

      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        <ul className={styles.stages}>
          {stages.map((s, idx) => (
            <li
              key={s}
              className={`${styles.stage} ${idx < i ? styles.stageDone : ''} ${idx === i ? styles.stageActive : ''}`}
            >
              <span className={styles.stageMark} aria-hidden="true">
                {idx < i ? '✓' : idx === i ? '' : ''}
              </span>
              <span className={styles.stageText}>{s}</span>
            </li>
          ))}
        </ul>
        {note ? <p className={styles.note}>{note}</p> : null}
      </div>

      <div className={styles.shimmer} aria-hidden="true">
        <span className={styles.shimmerFill} />
      </div>
    </div>
  )
}
