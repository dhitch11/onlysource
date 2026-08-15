'use client'

import { useState } from 'react'
import styles from './intelligence.module.css'

/**
 * THE PORTFOLIO BRIEF PANEL — "today's top plays" across the whole book.
 *
 * On demand it asks the server to write a strategic read of the candidate book from the measured
 * portfolio dossier. Same discipline as the per-corner brief: the button is the only thing that
 * spends a generation, a failure is an honest message, and when the analyst is not connected it says
 * so and shows no button.
 */

type Section = { label: string; body: string }

function parseSections(text: string): Section[] {
  const lines = text.split('\n')
  const sections: Section[] = []
  let current: Section | null = null
  const isLabel = (l: string) => /^[A-Z][A-Z' ]{2,48}$/.test(l.trim()) && l.trim().split(' ').length <= 7
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (isLabel(line)) {
      if (current) sections.push(current)
      current = { label: line, body: '' }
    } else if (current) {
      current.body += (current.body ? ' ' : '') + line
    } else {
      current = { label: '', body: line }
    }
  }
  if (current) sections.push(current)
  return sections.filter((s) => s.label || s.body)
}

export function PortfolioBrief({ configured }: { configured: boolean }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [sections, setSections] = useState<Section[]>([])
  const [error, setError] = useState('')

  async function run() {
    setState('loading')
    setError('')
    try {
      const resp = await fetch('/api/portfolio-brief', { method: 'POST' })
      const data = (await resp.json()) as { brief?: string; message?: string }
      if (!resp.ok || !data.brief) {
        setError(data.message || 'The analyst could not complete this brief.')
        setState('error')
        return
      }
      setSections(parseSections(data.brief))
      setState('done')
    } catch {
      setError('The request could not reach the analyst. Check the connection and try again.')
      setState('error')
    }
  }

  return (
    <section className={styles.brief}>
      <div className={styles.briefHead}>
        <div>
          <h2 className={styles.briefTitle}>Today&rsquo;s top plays</h2>
          <p className={styles.briefSub}>
            An AI read of the whole candidate book, written from the same measured numbers the charts
            below use. No figure appears that the feed did not measure.
          </p>
        </div>
        {configured ? (
          <button type="button" className={styles.briefBtn} onClick={run} disabled={state === 'loading'}>
            {state === 'loading' ? 'Reading the book…' : state === 'done' ? 'Regenerate' : 'Generate brief'}
          </button>
        ) : null}
      </div>

      {!configured ? (
        <p className={styles.briefEmpty}>
          The analyst is not connected in this environment. The charts and plays below stand on their own.
        </p>
      ) : null}

      {state === 'loading' ? (
        <div className={styles.briefLoading} aria-live="polite">
          <span className={styles.briefDot} />
          <span className={styles.briefDot} />
          <span className={styles.briefDot} />
          <span className={styles.briefLoadingText}>Reading supply chains, dispositions, and the top corners…</span>
        </div>
      ) : null}

      {state === 'error' ? (
        <p className={styles.briefError} role="alert">
          {error}
        </p>
      ) : null}

      {state === 'done' ? (
        <div className={styles.briefBody}>
          {sections.map((s, i) => (
            <div key={i} className={styles.briefSection}>
              {s.label ? <span className={styles.briefLabel}>{s.label}</span> : null}
              {s.body ? <p className={styles.briefText}>{s.body}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
