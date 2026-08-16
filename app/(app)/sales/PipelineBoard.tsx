'use client'

import { useMemo, useState } from 'react'
import {
  PIPELINE_STAGES,
  STAGE_LABEL,
  OWNER_LABEL,
  type PipelineStage,
  type DealOwner,
} from '@/lib/sales/pipeline'
import type { StoredDeal } from '@/lib/sales/deals-store'
import { Scrollable } from '@/components/ui/Scrollable'
import styles from './SalesHub.module.css'

const OWNERS: DealOwner[] = ['DH', 'DG', 'AI']
const usd = (n: number | null): string => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`)

type Draft = { title: string; ref: string; valueUsd: string; owner: DealOwner; stage: PipelineStage; nextAction: string }
const emptyDraft: Draft = { title: '', ref: '', valueUsd: '', owner: 'DH', stage: 'opportunities', nextAction: '' }

/**
 * THE PIPELINE BOARD — the operator's real, persisted deals.
 *
 * Add a deal, move it stage to stage, delete it; every change writes to the deal store and the
 * counts and totals are computed from the stored records, never estimated. Honest by construction:
 * an empty stage is empty because nothing is there, and a deal with no value shows "—", not a zero.
 */
export function PipelineBoard({ initial }: { initial: StoredDeal[] }) {
  const [deals, setDeals] = useState<StoredDeal[]>(initial)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [busy, setBusy] = useState(false)

  const byStage = useMemo(() => {
    const m = new Map<PipelineStage, StoredDeal[]>()
    for (const s of PIPELINE_STAGES) m.set(s, [])
    for (const d of deals) m.get(d.stage)?.push(d)
    return m
  }, [deals])

  async function save(body: Partial<StoredDeal>) {
    setBusy(true)
    try {
      const r = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = (await r.json()) as { deals?: StoredDeal[] }
      if (d.deals) setDeals(d.deals)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      const r = await fetch(`/api/deals?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const d = (await r.json()) as { deals?: StoredDeal[] }
      if (d.deals) setDeals(d.deals)
    } finally {
      setBusy(false)
    }
  }

  function move(deal: StoredDeal, dir: -1 | 1) {
    const i = PIPELINE_STAGES.indexOf(deal.stage)
    const next = PIPELINE_STAGES[i + dir]
    if (!next) return
    // Optimistic.
    setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, stage: next } : d)))
    void save({ id: deal.id, stage: next })
  }

  function addDeal() {
    // A deal must have a real title. The input's `required` + `pattern` surface the native
    // validation message; this guard is the belt behind them, so a whitespace-only title can
    // never write a junk card into the live pipeline. The server refuses it too.
    const title = draft.title.trim()
    if (!title) return
    const value = draft.valueUsd.trim() === '' ? null : Number(draft.valueUsd.replace(/[^0-9.]/g, ''))
    void save({
      title,
      ref: draft.ref.trim(),
      valueUsd: value != null && Number.isFinite(value) ? value : null,
      owner: draft.owner,
      stage: draft.stage,
      nextAction: draft.nextAction.trim() || null,
    })
    setDraft(emptyDraft)
    setAdding(false)
  }

  return (
    <>
      <div className={styles.boardBar}>
        <button type="button" className={styles.addBtn} onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : '+ Add a deal'}
        </button>
        <span className={styles.boardCount}>
          {deals.length.toLocaleString()} deal{deals.length === 1 ? '' : 's'} in the pipeline
        </span>
      </div>

      {adding ? (
        <form
          className={styles.addForm}
          onSubmit={(e) => {
            e.preventDefault()
            addDeal()
          }}
        >
          <input
            className={styles.input}
            placeholder="What is the deal? (title)"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            aria-label="Deal title"
            autoFocus
            // Same validation pattern Documents uses: the browser names the problem before a
            // request is made. `pattern` catches a whitespace-only title that `required` lets by.
            required
            pattern=".*\S.*"
          />
          <input className={styles.input} placeholder="NSN / solicitation ref" value={draft.ref} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} aria-label="Reference" />
          <input className={styles.input} placeholder="Value $ (optional)" value={draft.valueUsd} onChange={(e) => setDraft({ ...draft, valueUsd: e.target.value })} aria-label="Value in dollars" inputMode="numeric" />
          <select className={styles.input} value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value as DealOwner })} aria-label="Owner">
            {OWNERS.map((o) => (
              <option key={o} value={o}>
                {OWNER_LABEL[o]}
              </option>
            ))}
          </select>
          <select className={styles.input} value={draft.stage} onChange={(e) => setDraft({ ...draft, stage: e.target.value as PipelineStage })} aria-label="Stage">
            {PIPELINE_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
          <input className={styles.input} placeholder="Next action (optional)" value={draft.nextAction} onChange={(e) => setDraft({ ...draft, nextAction: e.target.value })} aria-label="Next action" />
          <button type="submit" className={styles.saveBtn} disabled={busy}>
            Add deal
          </button>
        </form>
      ) : null}

      <section aria-label="Pipeline">
        {/* The five stage columns scroll sideways; the fade + hint say so when they do, so a
            clipped WON & REVENUE column is never silently hidden. */}
        <Scrollable className={styles.pipe}>
        {PIPELINE_STAGES.map((stage) => {
          const stageDeals = byStage.get(stage) ?? []
          const total = stageDeals.reduce((s, d) => s + (d.valueUsd ?? 0), 0)
          const unknown = stageDeals.filter((d) => d.valueUsd == null).length
          const si = PIPELINE_STAGES.indexOf(stage)
          return (
            <div className={styles.col} key={stage}>
              <div className={styles.colHead}>
                <div className={styles.colTop}>
                  <span className={styles.dot} aria-hidden="true" />
                  <h2 className={styles.colName}>{STAGE_LABEL[stage]}</h2>
                </div>
                <span className={styles.colCount}>{stageDeals.length}</span>
                <span className={styles.colValue}>
                  {total > 0 ? usd(total) : '—'}
                  {unknown > 0 ? ` · ${unknown} without a value` : ''}
                </span>
              </div>
              <div className={styles.colBody}>
                {stageDeals.length === 0 ? (
                  <p className={styles.columnEmpty}>Nothing here yet.</p>
                ) : (
                  stageDeals.map((d) => (
                    <article className={styles.card} key={d.id}>
                      <p className={styles.cardTitle}>{d.title}</p>
                      {d.ref ? <p className={`mono ${styles.cardRef}`}>{d.ref}</p> : null}
                      <p className={styles.cardMeta}>
                        <span className={styles.owner} title={OWNER_LABEL[d.owner]} aria-label={`Owner ${OWNER_LABEL[d.owner]}`}>
                          {d.owner}
                        </span>
                        {d.valueUsd != null ? <span className={styles.cardValue}>{usd(d.valueUsd)}</span> : null}
                      </p>
                      {d.nextAction ? <p className={styles.cardNext}>{d.nextAction}</p> : null}
                      <div className={styles.cardControls}>
                        <button type="button" className={styles.moveBtn} disabled={si === 0 || busy} onClick={() => move(d, -1)} aria-label="Move back a stage">
                          ←
                        </button>
                        <button type="button" className={styles.moveBtn} disabled={si === PIPELINE_STAGES.length - 1 || busy} onClick={() => move(d, 1)} aria-label="Move forward a stage">
                          →
                        </button>
                        <button type="button" className={styles.delBtn} disabled={busy} onClick={() => remove(d.id)} aria-label="Delete deal">
                          ✕
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          )
        })}
        </Scrollable>
      </section>
    </>
  )
}
