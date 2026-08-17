'use client'

import { useState } from 'react'
import { AiLoader } from '@/components/ui/AiLoader'
import { ExplainButton } from '@/components/ui/ExplainButton'
import type { PursuitPackage } from '@/lib/intelligence/brief/package'
import { packageMarkdown } from '@/lib/intelligence/brief/package'
import styles from './pursuit-package.module.css'

/**
 * THE PURSUIT PACKAGE PANEL — one press, one premium deal memo.
 *
 * Lives on the corner dossier and on any pipeline card whose reference is a stock number.
 * The press is the only thing that spends a generation; the wait renders the staged house
 * loader because the deliverable model reads the whole package. The result is the memo, the
 * model that ACTUALLY wrote it, the count of anything the grounding guard withheld, the
 * suppliers the book can reach, a download of the whole package, and an email-me control
 * that renders the channel's true state before and after the click. Nothing here sends to
 * anyone but the operator, ever.
 */

export type EmailChannelState = {
  /** Would a send to the operator go out right now? From sendPreflight, server-side. */
  wouldSend: boolean
  /** The stated reason when it would not. */
  reason: string | null
  recipient: string
}

type Section = { label: string; body: string }

function parseSections(text: string): Section[] {
  const lines = text.split('\n')
  const sections: Section[] = []
  let current: Section | null = null
  const isLabel = (l: string) => /^[A-Z][A-Z' ]{2,48}$/.test(l.trim()) && l.trim().split(' ').length <= 6
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

type Result = { memo: string; pkg: PursuitPackage; model: string; unverified: string[] }
type EmailState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; to: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'error'; message: string }

export function PursuitPackagePanel({
  nsn,
  configured,
  emailChannel,
  heading = 'Pursuit package',
}: {
  nsn: string
  configured: boolean
  emailChannel: EmailChannelState
  heading?: string
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [email, setEmail] = useState<EmailState>({ kind: 'idle' })

  async function run() {
    setState('loading')
    setError('')
    setEmail({ kind: 'idle' })
    try {
      const resp = await fetch('/api/pursuit-package', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nsn }),
      })
      const data = (await resp.json()) as {
        memo?: string
        package?: PursuitPackage
        model?: string
        unverified?: string[]
        message?: string
      }
      if (!resp.ok || !data.memo || !data.package || !data.model) {
        setError(data.message || 'The package memo could not be written.')
        setState('error')
        return
      }
      setResult({ memo: data.memo, pkg: data.package, model: data.model, unverified: data.unverified ?? [] })
      setState('done')
    } catch {
      setError('The request could not reach the analyst. Check the connection and try again.')
      setState('error')
    }
  }

  function download() {
    if (!result) return
    const md = packageMarkdown(result.pkg, result.memo, result.model)
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pursuit-package-${nsn}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function emailMe() {
    if (!result || email.kind === 'sending') return
    setEmail({ kind: 'sending' })
    try {
      const resp = await fetch('/api/pursuit-package/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nsn, memo: result.memo, model: result.model }),
      })
      const data = (await resp.json()) as { sent?: boolean; to?: string; reason?: string; message?: string }
      if (resp.ok && data.sent) setEmail({ kind: 'sent', to: data.to ?? emailChannel.recipient })
      else if (resp.ok && data.sent === false)
        setEmail({ kind: 'refused', reason: data.reason ?? 'Not sent.' })
      else setEmail({ kind: 'error', message: data.message || 'The email could not be sent.' })
    } catch {
      setEmail({ kind: 'error', message: 'The request could not reach the server.' })
    }
  }

  const contactRows = result
    ? [
        ...result.pkg.suppliers.holders.map((h) => ({ role: 'Lists stock', company: h.company, cage: h.cage, c: h.inBook })),
        ...result.pkg.suppliers.approvedSources.map((s) => ({ role: 'Approved source', company: s.company, cage: s.cage, c: s.inBook })),
        ...result.pkg.suppliers.pastAwardees.map((a) => ({ role: 'Past awardee', company: a.company, cage: a.cage as string | null, c: a.inBook })),
      ].filter((r) => r.c && (r.c.email || r.c.phone))
    : []

  return (
    <section className={styles.panel} aria-label={`${heading} for ${nsn}`}>
      <div className={styles.head}>
        <div>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>{heading}</h2>
            <ExplainButton helpId="pursuit.pursuit_package" size="sm" />
          </div>
          <p className={styles.sub}>
            The engine assembles the measured facts: the corner case, the modeled economics with their
            basis, who holds or made the article, the named gaps. The analyst writes the memo from that
            package alone.
          </p>
        </div>
        {configured ? (
          <button type="button" className={styles.runBtn} onClick={run} disabled={state === 'loading'}>
            {state === 'loading' ? 'Assembling…' : state === 'done' ? 'Regenerate' : 'Generate package'}
          </button>
        ) : null}
      </div>

      {!configured ? (
        <p className={styles.empty}>
          The analyst is not connected in this environment, so no memo can be written here. The measured
          facts on this page are complete on their own.
        </p>
      ) : null}

      {state === 'loading' ? (
        <AiLoader
          title="Assembling your pursuit package"
          stages={[
            'Reading every award and price for this part',
            'Joining holders and approved sources to the supplier book',
            'Computing the modeled economics with their basis',
            'Naming the gaps a full read still has',
            'Writing the deal memo',
          ]}
          note="This takes a few seconds because the deliverable model reads the whole measured package for this exact part. Every number in the memo is one this build measured."
        />
      ) : null}

      {state === 'error' ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {state === 'done' && result ? (
        <div className={styles.body}>
          <div className={styles.memo}>
            {parseSections(result.memo).map((s, i) => (
              <div key={i} className={styles.section}>
                {s.label ? <span className={styles.label}>{s.label}</span> : null}
                {s.body ? <p className={styles.text}>{s.body}</p> : null}
              </div>
            ))}
          </div>

          <p className={styles.basis}>{result.pkg.economics.basis}</p>

          {contactRows.length > 0 ? (
            <div className={styles.contacts}>
              <span className={styles.contactsLabel}>Who the book can reach</span>
              <ul className={styles.contactList}>
                {contactRows.map((r, i) => (
                  <li key={i} className={styles.contactRow}>
                    <span className={styles.contactRole}>{r.role}</span>
                    <span className={styles.contactWho}>
                      {r.company ?? r.c?.company ?? '(unnamed)'}
                      {r.cage ? <span className={`mono ${styles.contactCage}`}> {r.cage}</span> : null}
                    </span>
                    <span className={styles.contactChannel}>
                      {r.c?.person ? `${r.c.person} · ` : ''}
                      {r.c?.email ? (
                        <a className={styles.contactMail} href={`mailto:${r.c.email}`}>
                          {r.c.email}
                        </a>
                      ) : null}
                      {r.c?.email && r.c?.phone ? ' · ' : ''}
                      {r.c?.phone ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className={styles.provenance}>
            Written by <span className="mono">{result.model}</span> from the measured package dossier.
            {result.unverified.length > 0
              ? ` ${result.unverified.length} sentence${result.unverified.length === 1 ? '' : 's'} withheld: they carried numbers this build did not measure.`
              : ' Nothing was withheld by the grounding guard.'}
          </p>

          <div className={styles.actions}>
            <button type="button" className={styles.actionBtn} onClick={download}>
              Download (.md)
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={emailMe}
              disabled={email.kind === 'sending'}
            >
              {email.kind === 'sending' ? 'Sending…' : 'Email me this package'}
            </button>
          </div>

          {/* The channel's TRUE state, before and after the click. Never a pretend send. */}
          {email.kind === 'idle' && !emailChannel.wouldSend ? (
            <p className={styles.channelNote}>{emailChannel.reason}</p>
          ) : null}
          {email.kind === 'idle' && emailChannel.wouldSend ? (
            <p className={styles.channelNote}>Delivers to {emailChannel.recipient}, and to nobody else.</p>
          ) : null}
          {email.kind === 'sent' ? (
            <p className={styles.channelSent} role="status">
              Sent to {email.to}.
            </p>
          ) : null}
          {email.kind === 'refused' ? (
            <p className={styles.channelNote} role="status">
              Not sent. {email.reason}
            </p>
          ) : null}
          {email.kind === 'error' ? (
            <p className={styles.error} role="alert">
              {email.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
