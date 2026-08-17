'use client'

import { useState } from 'react'
import { AiLoader } from '@/components/ui/AiLoader'
import { ExplainButton } from '@/components/ui/ExplainButton'
import type { OutreachDossier } from '@/lib/intelligence/suppliers/outreach-dossier'
import type { EmailChannelState } from './PursuitPackagePanel'
import styles from './pursuit-package.module.css'

/**
 * THE SUPPLIER OUTREACH DRAFT PANEL — the buy-side email, drafted, never sent.
 *
 * Renders on a pipeline card whose stock number has listed holders. One press writes the
 * draft on the deliverable slot, grounded in the outreach dossier; the operator copies it
 * (or emails it to THEMSELVES) and sends it from their own mail client. The panel names the
 * person and address the draft is written for, states the model that wrote it, and reports
 * anything the grounding guard withheld. Single-operator law, kept by construction.
 */

type Result = {
  draft: string
  dossier: OutreachDossier
  model: string
  unverified: string[]
}
type EmailState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; to: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'error'; message: string }

export function OutreachDraftPanel({
  nsn,
  configured,
  emailChannel,
}: {
  nsn: string
  configured: boolean
  emailChannel: EmailChannelState
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [email, setEmail] = useState<EmailState>({ kind: 'idle' })

  async function run() {
    setState('loading')
    setError('')
    setEmail({ kind: 'idle' })
    try {
      const resp = await fetch('/api/outreach-draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nsn }),
      })
      const data = (await resp.json()) as {
        draft?: string
        dossier?: OutreachDossier
        model?: string
        unverified?: string[]
        message?: string
      }
      if (!resp.ok || !data.draft || !data.dossier || !data.model) {
        setError(data.message || 'The draft could not be written.')
        setState('error')
        return
      }
      setResult({ draft: data.draft, dossier: data.dossier, model: data.model, unverified: data.unverified ?? [] })
      setState('done')
    } catch {
      setError('The request could not reach the analyst. Check the connection and try again.')
      setState('error')
    }
  }

  async function copy() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.draft)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* the button simply does not flip; nothing false is shown */
    }
  }

  async function emailMe() {
    if (!result || email.kind === 'sending') return
    setEmail({ kind: 'sending' })
    try {
      const resp = await fetch('/api/outreach-draft/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nsn, draft: result.draft, model: result.model }),
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

  const target = result?.dossier.target
  const book = target?.book ?? null

  return (
    <div className={styles.draftWrap} aria-label={`Supplier outreach draft for ${nsn}`}>
      <div className={styles.head}>
        <div>
          <div className={styles.titleRow}>
            <p className={styles.draftTitle}>Draft supplier outreach</p>
            <ExplainButton helpId="pursuit.outreach_draft" size="sm" />
          </div>
          <p className={styles.sub}>
            Buy-side, grounded in the measured facts for this stock number. You send it; the system
            never does.
          </p>
        </div>
        {configured ? (
          <button
            type="button"
            className={styles.actionBtn}
            onClick={run}
            disabled={state === 'loading'}
          >
            {state === 'loading' ? 'Drafting…' : state === 'done' ? 'Redraft' : 'Draft the email'}
          </button>
        ) : null}
      </div>

      {!configured ? (
        <p className={styles.empty}>
          The analyst is not connected in this environment, so no draft can be written here.
        </p>
      ) : null}

      {state === 'loading' ? (
        <AiLoader
          title="Drafting the buy-side email"
          stages={[
            'Reading who lists stock for this part',
            'Joining the holder to the researched supplier book',
            'Writing the dormant-inventory offer in plain language',
          ]}
          note="Grounded in the measured dossier for this exact part. Nothing is invented to fill a gap."
        />
      ) : null}

      {state === 'error' ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {state === 'done' && result ? (
        <div className={styles.body}>
          <p className={styles.channelNote}>
            {book?.email
              ? `Written for ${book.person ? `${book.person}, ` : ''}${book.email}${
                  target?.company ? ` at ${target.company}` : ''
                }. Send it from your own mail client.`
              : 'No email is on file for the target holder; the Suppliers book carries what is known. The draft is still yours to place.'}
          </p>
          <pre className={styles.draftBlock}>{result.draft}</pre>
          <p className={styles.provenance}>
            Written by <span className="mono">{result.model}</span> from the measured outreach dossier.
            {result.unverified.length > 0
              ? ` ${result.unverified.length} sentence${result.unverified.length === 1 ? '' : 's'} withheld: they carried numbers this build did not measure.`
              : ' Nothing was withheld by the grounding guard.'}
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.actionBtn} onClick={copy}>
              {copied ? 'Copied' : 'Copy draft'}
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={emailMe}
              disabled={email.kind === 'sending'}
            >
              {email.kind === 'sending' ? 'Sending…' : 'Email me this draft'}
            </button>
          </div>
          {email.kind === 'idle' && !emailChannel.wouldSend ? (
            <p className={styles.channelNote}>{emailChannel.reason}</p>
          ) : null}
          {email.kind === 'idle' && emailChannel.wouldSend ? (
            <p className={styles.channelNote}>
              Delivers to {emailChannel.recipient}, and to nobody else. You forward it yourself.
            </p>
          ) : null}
          {email.kind === 'sent' ? (
            <p className={styles.channelSent} role="status">
              Sent to {email.to}. Nothing was sent to the supplier.
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
    </div>
  )
}
