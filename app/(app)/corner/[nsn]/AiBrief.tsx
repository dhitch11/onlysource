'use client'

import { useState } from 'react'
import styles from './corner.module.css'

/**
 * THE AI BRIEF PANEL.
 *
 * On demand, it asks the server to write a plain-English read of THIS corner from the measured
 * dossier on the page. The button is the only thing that spends a generation, so nothing is billed
 * on page load, and a failure renders as an honest message, never as a half-written brief. When the
 * analyst is not connected in this environment the panel says so and shows no button, because a
 * control that cannot work is worse than one that is absent.
 */

type Section = { label: string; body: string }

// The model is told to emit short ALL-CAPS labels on their own line. Parse them into blocks; if it
// deviates, fall back to showing the whole text so nothing is ever swallowed.
function parseSections(text: string): Section[] {
  const lines = text.split('\n')
  const sections: Section[] = []
  let current: Section | null = null
  const isLabel = (l: string) => /^[A-Z][A-Z' ]{2,40}$/.test(l.trim()) && l.trim().split(' ').length <= 6
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

export function AiBrief({ nsn, configured }: { nsn: string; configured: boolean }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [sections, setSections] = useState<Section[]>([])
  const [error, setError] = useState('')

  async function run() {
    setState('loading')
    setError('')
    try {
      const resp = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nsn }),
      })
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
          <h2 className={styles.briefTitle}>AI opportunity brief</h2>
          <p className={styles.briefSub}>
            Written from the measured dossier on this page. No number appears that this build did not
            measure.
          </p>
        </div>
        {configured ? (
          <button
            type="button"
            className={styles.briefBtn}
            onClick={run}
            disabled={state === 'loading'}
          >
            {state === 'loading'
              ? 'Reading the dossier…'
              : state === 'done'
                ? 'Regenerate'
                : 'Generate brief'}
          </button>
        ) : null}
      </div>

      {!configured ? (
        <p className={styles.briefEmpty}>
          The analyst is not connected in this environment. The dossier above is complete on its own.
        </p>
      ) : null}

      {state === 'loading' ? (
        <div className={styles.briefLoading} aria-live="polite">
          <span className={styles.briefDot} />
          <span className={styles.briefDot} />
          <span className={styles.briefDot} />
          <span className={styles.briefLoadingText}>Reading the award history, forecast, and score…</span>
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
