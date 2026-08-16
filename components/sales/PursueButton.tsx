'use client'

/*
 * <PursueButton /> THE PURSUIT WIRE. The one control that turns a found opportunity into
 * a real deal (owner directive 2026-08-16: "every option in the menu should have action
 * behind it... a platform that will find opportunities and do the whole process all the way
 * through close").
 *
 * It appears on every opportunity row that can HONESTLY carry it: Monopoly Map rows, the
 * corner dossier, Goldmine and HUBZone rows that link to a corner, and the dashboard's
 * corner-naming signal cards. Pressing it creates a REAL deal through /api/deals:
 *
 *   title      the stock number and item name, verbatim from the government file
 *   ref/niin   the stock number, so every surface recognises this part as pursued
 *   valueUsd   quantity x last award unit price ONLY when both were measured. This is a
 *              MODELED BUY VALUE and it is labeled so. When either input is unread the
 *              value is null and the pipeline says "no value", never an invention.
 *   stage      'opportunities', with the honest first next action seeded.
 *
 * FEEDBACK IS THE HOUSE KIND, NOT AN ALERT. On success the control flips to "In pipeline"
 * with a real link to /sales. Pressing twice cannot duplicate: the API dedupes by
 * reference server-side and returns the existing deal, and this component treats that
 * {existing:true} answer as the same success.
 *
 * The busy state keeps its width (label held at zero opacity, spinner overlaid, announced
 * through a live region), the same discipline as <Button>. A failed save says so inline
 * and leaves the button pressable; it never pretends.
 */

import { useState } from 'react'
import Link from 'next/link'
import { PURSUE_NEXT_ACTION, type DealOwner, type PipelineStage } from '@/lib/sales/pipeline'
import styles from './PursueButton.module.css'

export interface PursueButtonProps {
  /** The stock number, formatted as the surface shows it. Becomes the deal ref. */
  nsn: string
  niin: string | null
  /** The item name from the government file. '' renders the NSN alone. */
  item: string
  /**
   * MODELED BUY VALUE: quantity x last award unit price, computed by the CALLER only when
   * both legs were measured, else null. This component never computes or invents it.
   */
  valueUsd: number | null
  /** True when this reference is already a deal (computed server-side from the store). */
  initiallyInPipeline: boolean
  /** 'row' is the compact grid form; 'primary' is the dossier's full-size call to action. */
  appearance?: 'row' | 'primary'
}

type Phase = 'idle' | 'busy' | 'done' | 'failed'

export function PursueButton({
  nsn,
  niin,
  item,
  valueUsd,
  initiallyInPipeline,
  appearance = 'row',
}: PursueButtonProps) {
  const [phase, setPhase] = useState<Phase>(initiallyInPipeline ? 'done' : 'idle')

  async function pursue() {
    if (phase === 'busy' || phase === 'done') return
    setPhase('busy')
    try {
      const r = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: item.trim() ? `${nsn} · ${item.trim()}` : nsn,
          ref: nsn,
          niin,
          valueUsd,
          stage: 'opportunities' satisfies PipelineStage,
          owner: 'DH' satisfies DealOwner,
          nextAction: PURSUE_NEXT_ACTION,
        }),
      })
      if (!r.ok) throw new Error(`deal create answered ${r.status}`)
      // {existing:true} is the dedupe answering "already yours": the same success.
      await r.json()
      setPhase('done')
    } catch {
      setPhase('failed')
    }
  }

  if (phase === 'done') {
    return (
      <Link
        href={'/sales' as never}
        className={`${styles.inPipeline} ${appearance === 'primary' ? styles.inPipelinePrimary : ''}`}
        aria-label={`${nsn} is in the pipeline. Open the pipeline`}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={styles.check}>
          <path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        In pipeline
        <span aria-hidden="true"> →</span>
      </Link>
    )
  }

  const busy = phase === 'busy'
  return (
    <span className={appearance === 'primary' ? styles.primaryWrap : styles.rowWrap}>
      <button
        type="button"
        className={appearance === 'primary' ? styles.primaryBtn : styles.rowBtn}
        onClick={pursue}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={
          appearance === 'row'
            ? `Pursue ${nsn}: start a deal in the pipeline`
            : undefined
        }
      >
        {/* The label holds the box open while busy, so the layout never shifts. */}
        <span className={busy ? styles.labelHidden : undefined}>
          {appearance === 'primary' ? 'Pursue this corner' : 'Pursue'}
        </span>
        {busy ? (
          <>
            <span className={styles.spinner} aria-hidden="true" />
            <span role="status" aria-live="polite" className="vh">
              Adding {nsn} to the pipeline
            </span>
          </>
        ) : null}
      </button>

      {appearance === 'primary' ? (
        <span className={styles.valueLine}>
          {valueUsd != null
            ? `Starts a deal at a modeled buy value of $${Math.round(valueUsd).toLocaleString()} (quantity x last award price, modeled, not a quote).`
            : 'Starts a deal with no value: quantity or award price is unread, so nothing is invented.'}
        </span>
      ) : null}

      {phase === 'failed' ? (
        <span role="alert" className={styles.err}>
          Could not save. Press again to retry.
        </span>
      ) : null}
    </span>
  )
}
