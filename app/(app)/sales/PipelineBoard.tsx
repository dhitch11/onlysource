'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  PIPELINE_STAGES,
  STAGE_LABEL,
  OWNER_LABEL,
  normalizeDealRef,
  type PipelineStage,
  type DealOwner,
} from '@/lib/sales/pipeline'
import type { StoredDeal } from '@/lib/sales/deals-store'
import { Scrollable } from '@/components/ui/Scrollable'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { PursuitPackagePanel, type EmailChannelState } from '@/components/sales/PursuitPackagePanel'
import { OutreachDraftPanel } from '@/components/sales/OutreachDraftPanel'
import styles from './SalesHub.module.css'

const OWNERS: DealOwner[] = ['DH', 'DG', 'AI']
const usd = (n: number | null): string => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`)

/** The stock number behind a ref, when the ref IS one. 13 contiguous digits, else null. */
const nsnOf = (ref: string): string | null => {
  const n = normalizeDealRef(ref)
  return /^\d{13}$/.test(n) ? n : null
}

type Draft = { title: string; ref: string; valueUsd: string; owner: DealOwner; stage: PipelineStage; nextAction: string }
const emptyDraft: Draft = { title: '', ref: '', valueUsd: '', owner: 'DH', stage: 'opportunities', nextAction: '' }

/** The inline flow a move can open before anything is posted. */
type PendingMove =
  | { kind: 'close'; dealId: string; value: string; wonRef: string; basis: 'material_confirmed' | 'documents_received' }
  | { kind: 'attest'; dealId: string; to: 'leads' }

/**
 * THE PIPELINE BOARD — the operator's real, persisted deals, with an honest close.
 *
 * Moving a card is now a guarded act, matching the server's wired state machine:
 *   - into LEADS asks the operator to attest that a supplier pursuit is actually running;
 *   - into QUOTING the server checks a saved Documents packet for this stock number;
 *   - into WON & REVENUE a small form takes the ACTUAL close amount (the modeled value is
 *     offered as an editable default), the award or PO reference, and the basis. Won &
 *     Revenue sums RECORDED closes only and says so.
 * A refusal from the server renders on the card in the server's own words; nothing moves
 * optimistically, so the board never shows a state the store refused.
 *
 * Cards stopped being dead ends: a stock-number ref links to its corner dossier, carries the
 * pursuit-package generator, and, where the export lists holders, the supplier outreach
 * draft.
 */
export function PipelineBoard({
  initial,
  outreachRefs,
  analystConfigured,
  emailChannel,
}: {
  initial: StoredDeal[]
  /** Normalized refs whose stock number has listed holders (computed server-side). */
  outreachRefs: string[]
  analystConfigured: boolean
  emailChannel: EmailChannelState
}) {
  const [deals, setDeals] = useState<StoredDeal[]>(initial)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingMove | null>(null)
  /** Per-card server messages: a refusal in the server's words, or an honest note. */
  const [cardMsg, setCardMsg] = useState<Record<string, { kind: 'refusal' | 'note'; text: string }>>({})
  const [openPanel, setOpenPanel] = useState<Record<string, 'package' | 'outreach' | null>>({})

  const outreachSet = useMemo(() => new Set(outreachRefs), [outreachRefs])

  const byStage = useMemo(() => {
    const m = new Map<PipelineStage, StoredDeal[]>()
    for (const s of PIPELINE_STAGES) m.set(s, [])
    for (const d of deals) m.get(d.stage)?.push(d)
    return m
  }, [deals])

  async function save(body: Record<string, unknown>, dealId?: string): Promise<boolean> {
    setBusy(true)
    try {
      const r = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = (await r.json()) as { deals?: StoredDeal[]; message?: string; note?: string }
      if (d.deals) setDeals(d.deals)
      if (dealId) {
        if (!r.ok) {
          setCardMsg((m) => ({ ...m, [dealId]: { kind: 'refusal', text: d.message || 'The server refused this change.' } }))
          return false
        }
        setCardMsg((m) => {
          const next = { ...m }
          if (d.note) next[dealId] = { kind: 'note', text: d.note }
          else delete next[dealId]
          return next
        })
      }
      return r.ok
    } catch {
      if (dealId) {
        setCardMsg((m) => ({ ...m, [dealId]: { kind: 'refusal', text: 'The request could not reach the server.' } }))
      }
      return false
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

  function requestMove(deal: StoredDeal, dir: -1 | 1) {
    const i = PIPELINE_STAGES.indexOf(deal.stage)
    const next = PIPELINE_STAGES[i + dir]
    if (!next) return
    if (next === 'won_revenue') {
      // The close form: actual amount (modeled offered as the editable default), award ref, basis.
      setPending({
        kind: 'close',
        dealId: deal.id,
        value: deal.valueUsd != null ? String(Math.round(deal.valueUsd)) : '',
        wonRef: '',
        basis: 'material_confirmed',
      })
      return
    }
    if (next === 'leads') {
      setPending({ kind: 'attest', dealId: deal.id, to: 'leads' })
      return
    }
    void save({ id: deal.id, stage: next }, deal.id)
  }

  async function submitClose(deal: StoredDeal, p: Extract<PendingMove, { kind: 'close' }>) {
    const value = Number(p.value.replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(value) || p.value.trim() === '') {
      setCardMsg((m) => ({ ...m, [deal.id]: { kind: 'refusal', text: 'Recording a win needs the actual close amount in dollars.' } }))
      return
    }
    if (!p.wonRef.trim()) {
      setCardMsg((m) => ({ ...m, [deal.id]: { kind: 'refusal', text: 'Recording a win needs the award or PO reference, so the figure traces to a record.' } }))
      return
    }
    const ok = await save(
      { id: deal.id, stage: 'won_revenue', wonValueUsd: value, wonRef: p.wonRef.trim(), wonBasis: p.basis },
      deal.id,
    )
    if (ok) setPending(null)
  }

  async function submitAttest(deal: StoredDeal) {
    const ok = await save({ id: deal.id, stage: 'leads', attest: 'outreach_running' }, deal.id)
    if (ok) setPending(null)
  }

  function addDeal() {
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
          {/* A deal is never born won: the close is recorded on the MOVE into Won, so the
              recorded amount always exists. The server refuses it too. */}
          <select className={styles.input} value={draft.stage} onChange={(e) => setDraft({ ...draft, stage: e.target.value as PipelineStage })} aria-label="Stage">
            {PIPELINE_STAGES.filter((s) => s !== 'won_revenue').map((s) => (
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
          const isWon = stage === 'won_revenue'
          /*
           * WON & REVENUE SUMS RECORDED CLOSES ONLY. Every other column sums the modeled
           * value it always has. The two are different facts and the label says which one
           * the reader is looking at.
           */
          const total = stageDeals.reduce(
            (s, d) => s + ((isWon ? d.wonValueUsd : d.valueUsd) ?? 0),
            0,
          )
          const unknown = stageDeals.filter((d) => (isWon ? d.wonValueUsd : d.valueUsd) == null).length
          const si = PIPELINE_STAGES.indexOf(stage)
          return (
            <div className={styles.col} key={stage}>
              <div className={styles.colHead}>
                <div className={styles.colTop}>
                  <span className={styles.dot} aria-hidden="true" />
                  <h2 className={styles.colName}>{STAGE_LABEL[stage]}</h2>
                  {/* Every column head explains its gate; Won and Revenue explains the
                      recorded close its total is made of. Both entries were written and
                      registered since the pursuit build and mounted nowhere (census). */}
                  <ExplainButton helpId={isWon ? 'pursuit.recorded_close' : 'pursuit.stage_guard'} size="sm" />
                </div>
                <span className={styles.colCount}>{stageDeals.length}</span>
                <span className={styles.colValue}>
                  {total > 0 ? usd(total) : '—'}
                  {isWon && total > 0 ? ' recorded' : ''}
                  {unknown > 0 ? ` · ${unknown} without ${isWon ? 'a recorded close' : 'a value'}` : ''}
                </span>
              </div>
              <div className={styles.colBody}>
                {stageDeals.length === 0 ? (
                  <p className={styles.columnEmpty}>Nothing here yet.</p>
                ) : (
                  stageDeals.map((d) => {
                    const nsn = nsnOf(d.ref)
                    const canOutreach = nsn != null && outreachSet.has(normalizeDealRef(d.ref))
                    const msg = cardMsg[d.id]
                    const panel = openPanel[d.id] ?? null
                    const isPending = pending && pending.dealId === d.id
                    return (
                      <article className={styles.card} key={d.id}>
                        {nsn ? (
                          <Link href={`/corner/${nsn}` as never} className={styles.cardTitleLink}>
                            {d.title}
                          </Link>
                        ) : (
                          <p className={styles.cardTitle}>{d.title}</p>
                        )}
                        {d.ref ? <p className={`mono ${styles.cardRef}`}>{d.ref}</p> : null}
                        <p className={styles.cardMeta}>
                          <span className={styles.owner} title={OWNER_LABEL[d.owner]} aria-label={`Owner ${OWNER_LABEL[d.owner]}`}>
                            {d.owner}
                          </span>
                          {isWon ? (
                            d.wonValueUsd != null ? (
                              <span className={styles.cardWon}>
                                {usd(d.wonValueUsd)} recorded
                                {d.wonRef ? <span className={`mono ${styles.cardWonRef}`}> · {d.wonRef}</span> : null}
                              </span>
                            ) : (
                              <span className={styles.cardValue}>no recorded close</span>
                            )
                          ) : d.valueUsd != null ? (
                            <span className={styles.cardValue}>{usd(d.valueUsd)} modeled</span>
                          ) : null}
                        </p>
                        {d.nextAction ? <p className={styles.cardNext}>{d.nextAction}</p> : null}

                        {msg ? (
                          /* A div with a real dismiss control: the refusal used to replace the
                             card's description with no way back short of satisfying the gate or
                             deleting the deal. Dismissing hides the MESSAGE only; the gate
                             itself still refuses on the next attempt, server-side. */
                          <div
                            className={msg.kind === 'refusal' ? styles.cardRefusal : styles.cardNote}
                            role={msg.kind === 'refusal' ? 'alert' : 'status'}
                          >
                            <span className={styles.cardMsgText}>{msg.text}</span>
                            <button
                              type="button"
                              className={styles.cardMsgDismiss}
                              aria-label="Dismiss this message"
                              onClick={() =>
                                setCardMsg((m) => {
                                  const next = { ...m }
                                  delete next[d.id]
                                  return next
                                })
                              }
                            >
                              ✕
                            </button>
                          </div>
                        ) : null}

                        {isPending && pending.kind === 'close' ? (
                          <form
                            className={styles.closeForm}
                            onSubmit={(e) => {
                              e.preventDefault()
                              void submitClose(d, pending)
                            }}
                          >
                            <div className={styles.closeFormTitleRow}>
                              <p className={styles.closeFormTitle}>Record the close</p>
                              <ExplainButton helpId="pursuit.recorded_close" size="sm" />
                            </div>
                            <label className={styles.closeField}>
                              <span>Actual amount $</span>
                              <input
                                className={styles.input}
                                value={pending.value}
                                onChange={(e) => setPending({ ...pending, value: e.target.value })}
                                inputMode="decimal"
                                aria-label="Actual close amount in dollars"
                                autoFocus
                              />
                            </label>
                            {d.valueUsd != null ? (
                              <p className={styles.closeHint}>
                                Prefilled with the modeled {usd(d.valueUsd)}. Enter what it actually closed for.
                              </p>
                            ) : (
                              <p className={styles.closeHint}>No modeled value existed; enter the real amount.</p>
                            )}
                            <label className={styles.closeField}>
                              <span>Award / PO reference</span>
                              <input
                                className={styles.input}
                                value={pending.wonRef}
                                onChange={(e) => setPending({ ...pending, wonRef: e.target.value })}
                                aria-label="Award or PO reference"
                                placeholder="SPE… / PO number"
                              />
                            </label>
                            <label className={styles.closeField}>
                              <span>Basis</span>
                              <select
                                className={styles.input}
                                value={pending.basis}
                                onChange={(e) =>
                                  setPending({ ...pending, basis: e.target.value as 'material_confirmed' | 'documents_received' })
                                }
                                aria-label="Close basis"
                              >
                                <option value="material_confirmed">Material confirmed</option>
                                <option value="documents_received">Documents received</option>
                              </select>
                            </label>
                            <div className={styles.closeActions}>
                              <button type="submit" className={styles.saveBtn} disabled={busy}>
                                Record win
                              </button>
                              <button type="button" className={styles.moveBtn} onClick={() => setPending(null)}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : null}

                        {isPending && pending.kind === 'attest' ? (
                          <div className={styles.closeForm}>
                            <div className={styles.closeFormTitleRow}>
                              <p className={styles.closeFormTitle}>Move to Leads</p>
                              <ExplainButton helpId="pursuit.stage_guard" size="sm" />
                            </div>
                            <p className={styles.closeHint}>
                              Leads means a supplier pursuit is actually running. Your confirmation is
                              recorded in the audit trail as an attestation.
                            </p>
                            <div className={styles.closeActions}>
                              <button type="button" className={styles.saveBtn} disabled={busy} onClick={() => void submitAttest(d)}>
                                Outreach is running
                              </button>
                              <button type="button" className={styles.moveBtn} onClick={() => setPending(null)}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {nsn ? (
                          <div className={styles.cardTools}>
                            <button
                              type="button"
                              className={`${styles.toolBtn} ${panel === 'package' ? styles.toolBtnOn : ''}`}
                              aria-expanded={panel === 'package'}
                              onClick={() =>
                                setOpenPanel((m) => ({ ...m, [d.id]: m[d.id] === 'package' ? null : 'package' }))
                              }
                            >
                              Pursuit package
                            </button>
                            {canOutreach ? (
                              <button
                                type="button"
                                className={`${styles.toolBtn} ${panel === 'outreach' ? styles.toolBtnOn : ''}`}
                                aria-expanded={panel === 'outreach'}
                                onClick={() =>
                                  setOpenPanel((m) => ({ ...m, [d.id]: m[d.id] === 'outreach' ? null : 'outreach' }))
                                }
                              >
                                Draft supplier outreach
                              </button>
                            ) : null}
                          </div>
                        ) : null}

                        {nsn && panel === 'package' ? (
                          <div className={styles.cardPanel}>
                            <PursuitPackagePanel
                              nsn={nsn}
                              configured={analystConfigured}
                              emailChannel={emailChannel}
                              heading="Pursuit package"
                            />
                          </div>
                        ) : null}
                        {nsn && panel === 'outreach' ? (
                          <div className={styles.cardPanel}>
                            <OutreachDraftPanel nsn={nsn} configured={analystConfigured} emailChannel={emailChannel} />
                          </div>
                        ) : null}

                        <div className={styles.cardControls}>
                          <button type="button" className={styles.moveBtn} disabled={si === 0 || busy} onClick={() => requestMove(d, -1)} aria-label="Move back a stage">
                            ←
                          </button>
                          <button type="button" className={styles.moveBtn} disabled={si === PIPELINE_STAGES.length - 1 || busy} onClick={() => requestMove(d, 1)} aria-label="Move forward a stage">
                            →
                          </button>
                          <button type="button" className={styles.delBtn} disabled={busy} onClick={() => remove(d.id)} aria-label="Delete deal">
                            ✕
                          </button>
                        </div>
                      </article>
                    )
                  })
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
