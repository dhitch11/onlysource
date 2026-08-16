'use client'

import { useState } from 'react'
import type { AlertSettings, ChannelPrefs } from '@/lib/notify/settings'
import type { SignalKind } from '@/lib/notify/signals'
import styles from './settings.module.css'

type KindMeta = { kind: SignalKind; label: string; describe: string }

/**
 * The live alert-settings form. Every change autosaves to the server, so there is no "save" button
 * to forget. A high-contrast saved/failed line reports what happened; a test button proves the email
 * path end to end without waiting for the scheduler.
 */
export function SettingsForm({
  initial,
  kinds,
  emailConfigured,
}: {
  initial: AlertSettings
  kinds: KindMeta[]
  emailConfigured: boolean
}) {
  const [s, setS] = useState<AlertSettings>(initial)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [testMsg, setTestMsg] = useState('')

  async function save(next: AlertSettings) {
    setS(next)
    setStatus('saving')
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      })
      setStatus(r.ok ? 'saved' : 'error')
    } catch {
      setStatus('error')
    }
  }

  const setMaster = (ch: keyof ChannelPrefs, v: boolean) => save({ ...s, master: { ...s.master, [ch]: v } })
  const setKind = (kind: SignalKind, ch: keyof ChannelPrefs, v: boolean) =>
    save({ ...s, perKind: { ...s.perKind, [kind]: { ...s.perKind[kind], [ch]: v } } })
  const setRecipient = (email: string) => setS({ ...s, emailRecipient: email })

  async function sendTest() {
    setTestState('sending')
    setTestMsg('')
    try {
      const r = await fetch('/api/alerts/send?test=1', { method: 'POST' })
      const d = (await r.json()) as { ok?: boolean; sent?: boolean; to?: string; message?: string; reason?: string }
      if (r.ok && d.sent) {
        setTestState('sent')
        setTestMsg(`Test sent to ${d.to}.`)
      } else if (r.ok && !d.sent) {
        setTestState('sent')
        setTestMsg(d.reason || 'No email-enabled signals to send right now.')
      } else {
        setTestState('error')
        setTestMsg(d.message || 'The test could not be sent.')
      }
    } catch {
      setTestState('error')
      setTestMsg('The test could not reach the server.')
    }
  }

  return (
    <div className={styles.stack}>
      {/* master channels */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Channels</h2>
          <span className={styles.saveLine} aria-live="polite">
            {status === 'saving' ? 'Saving…' : status === 'saved' ? 'All changes saved' : status === 'error' ? 'Save failed. Try again.' : ''}
          </span>
        </div>
        <p className={styles.cardSub}>Turn a whole channel off here and nothing uses it, whatever the choices below.</p>
        <div className={styles.masterRow}>
          <Toggle label="Show in the app" checked={s.master.inApp} onChange={(v) => setMaster('inApp', v)} />
          <Toggle
            label="Send me email"
            checked={s.master.email}
            onChange={(v) => setMaster('email', v)}
            disabled={!emailConfigured}
          />
        </div>
        {!emailConfigured ? (
          <p className={styles.notice}>Email is not connected in this environment yet, so the email toggles are held off. The in-app bell works now.</p>
        ) : null}
        <label className={styles.recipient}>
          <span className={styles.recipientLabel}>Email alerts go to</span>
          <input
            className={styles.input}
            type="email"
            value={s.emailRecipient}
            onChange={(e) => setRecipient(e.target.value)}
            onBlur={() => save(s)}
            disabled={!emailConfigured}
            aria-label="Email recipient for alerts"
          />
        </label>
      </section>

      {/* per-kind */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>What pings you</h2>
        <p className={styles.cardSub}>Pick a channel for each kind of signal. Off on both means it never bothers you.</p>
        <div className={styles.kindTable}>
          <div className={`${styles.kindRow} ${styles.kindHeadRow}`}>
            <span>Signal</span>
            <span className={styles.colHead}>In app</span>
            <span className={styles.colHead}>Email</span>
          </div>
          {kinds.map((k) => (
            <div key={k.kind} className={styles.kindRow}>
              <span className={styles.kindText}>
                <span className={styles.kindLabel}>{k.label}</span>
                <span className={styles.kindDescribe}>{k.describe}</span>
              </span>
              <Check checked={s.perKind[k.kind].inApp} onChange={(v) => setKind(k.kind, 'inApp', v)} label={`${k.label} in app`} />
              <Check
                checked={s.perKind[k.kind].email}
                onChange={(v) => setKind(k.kind, 'email', v)}
                label={`${k.label} email`}
                disabled={!emailConfigured}
              />
            </div>
          ))}
        </div>
      </section>

      {/* test */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Test it</h2>
        <p className={styles.cardSub}>Send yourself the alert email right now with today&rsquo;s live signals, so you know it works.</p>
        <div className={styles.testRow}>
          <button type="button" className={styles.testBtn} onClick={sendTest} disabled={!emailConfigured || testState === 'sending'}>
            {testState === 'sending' ? 'Sending…' : 'Send me a test'}
          </button>
          {testMsg ? (
            <span className={`${styles.testMsg} ${testState === 'error' ? styles.testErr : ''}`}>{testMsg}</span>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`${styles.switch} ${checked && !disabled ? styles.switchOn : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchKnob} />
      <span className={styles.switchText}>{label}</span>
    </button>
  )
}

function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`${styles.check} ${checked && !disabled ? styles.checkOn : ''}`}
      onClick={() => onChange(!checked)}
    >
      {checked && !disabled ? '✓' : ''}
    </button>
  )
}
