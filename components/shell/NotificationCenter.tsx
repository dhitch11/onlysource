'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import styles from './notification-center.module.css'

/**
 * THE NOTIFICATION CENTRE — the bell, the panel, and the pop-up.
 *
 * It pulls the live signal feed and shows what needs attention: a badge counts what this device has
 * not seen yet, the panel lists every signal with a plain sentence and a way in, and a high-severity
 * signal the operator has not seen pops a toast once per session. "Seen" is tracked per device in
 * local storage, which is honest: there is no server read-state yet, so it never claims to know what
 * was read anywhere else. Nothing here invents a signal; it renders exactly what the engine returned.
 */

type Signal = {
  id: string
  kind: string
  severity: 'high' | 'medium' | 'info'
  title: string
  body: string
  href: string
}

const SEEN_KEY = 'os_seen_signals'
const TOAST_KEY = 'os_toast_shown'
const SEV_LABEL: Record<Signal['severity'], string> = { high: 'Act now', medium: 'Worth an hour', info: 'FYI' }

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

export function NotificationCenter() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [open, setOpen] = useState(false)
  const [unseen, setUnseen] = useState(0)
  const [toast, setToast] = useState<Signal | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/signals')
      .then((r) => (r.ok ? r.json() : { signals: [] }))
      .then((d: { signals?: Signal[] }) => {
        if (!alive) return
        const list = d.signals ?? []
        setSignals(list)
        const seen = loadSeen()
        setUnseen(list.filter((s) => !seen.has(s.id)).length)
        // One toast per session, for the most urgent unseen signal. NOT on a phone-width
        // viewport: at 390px every fixed overlay sits on top of real numbers (the metric
        // cards fill the screen), and occluding data to announce data is self-defeating.
        // The bell badge carries the same unseen count there, so nothing is lost.
        const phoneWidth = window.matchMedia('(max-width: 560px)').matches
        if (!phoneWidth && !sessionStorage.getItem(TOAST_KEY)) {
          const urgent = list.find((s) => s.severity === 'high' && !seen.has(s.id))
          if (urgent) {
            setToast(urgent)
            sessionStorage.setItem(TOAST_KEY, '1')
          }
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const markAllSeen = () => {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(signals.map((s) => s.id)))
    } catch {}
    setUnseen(0)
  }

  const toggle = () => {
    setOpen((v) => {
      const next = !v
      if (next) {
        markAllSeen()
        // The panel lists every signal the toast could name, so the toast has nothing to add
        // while it is open, and dismissing it here guarantees the two never overlap.
        setToast(null)
      }
      return next
    })
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.bell}
        aria-label={`Notifications${unseen > 0 ? `, ${unseen} new` : ''}`}
        aria-expanded={open}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
          <path
            d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {unseen > 0 ? <span className={styles.badge}>{unseen > 9 ? '9+' : unseen}</span> : null}
      </button>

      {open ? (
        <div className={styles.panel} role="dialog" aria-label="Notifications">
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>Signals</span>
            <Link href={'/settings' as never} className={styles.panelSettings} onClick={() => setOpen(false)}>
              Settings
            </Link>
          </div>
          {signals.length === 0 ? (
            <p className={styles.empty}>Nothing needs your attention right now. This fills up as the feed moves.</p>
          ) : (
            <ul className={styles.list}>
              {signals.map((s) => (
                <li key={s.id} className={styles.item}>
                  <Link href={s.href as never} className={styles.itemLink} onClick={() => setOpen(false)}>
                    <span className={`${styles.sev} ${styles[`sev_${s.severity}`]}`}>{SEV_LABEL[s.severity]}</span>
                    <span className={styles.itemTitle}>{s.title}</span>
                    <span className={styles.itemBody}>{s.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {toast ? (
        <div className={styles.toast} role="status" aria-live="polite">
          <span className={`${styles.sev} ${styles.sev_high}`}>Act now</span>
          <span className={styles.toastTitle}>{toast.title}</span>
          <span className={styles.toastBody}>{toast.body}</span>
          <div className={styles.toastActions}>
            <Link href={toast.href as never} className={styles.toastOpen} onClick={() => setToast(null)}>
              Open
            </Link>
            <button type="button" className={styles.toastDismiss} onClick={() => setToast(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
