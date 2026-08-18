'use client'

import { useEffect, useState } from 'react'
import s from './documents.module.css'

type Packet = { id: string; label: string; nsn: string; query: string; savedAt: number }

const UNREACHABLE = 'The server could not be reached, so nothing was saved.'
const UNREADABLE = 'The server answered with something unreadable, so nothing was saved.'
const SESSION_GONE =
  'This session is no longer signed in, so nothing was saved. Reload the page and sign in again.'
/** The list could not be read. NOT the same fact as an empty vault, and never drawn as one. */
const LIST_UNREADABLE =
  'Your saved packets could not be read just now, so this list is not showing them. It is not empty. Reload the page to try again.'

/** What a /api/packets response actually means. Saved, or refused with a sentence to show. */
export type PacketOutcome =
  | { kind: 'saved'; packets: Packet[] }
  | { kind: 'refused'; problem: string }

/**
 * READ A /api/packets RESPONSE HONESTLY. The one decision this component used to get wrong.
 *
 * Pure, exported and tested directly against a REAL refusal produced by the real route handler,
 * because this is the exact line that turned a 403 into a cleared form. It is given the two
 * facts about the response that are not in the body, `ok` and `redirected`, and it must never
 * infer either of them from the body: a followed redirect answers 200 with HTML, and a refusal
 * answers with a `message` and no `packets` at all.
 *
 * ORDER MATTERS AND IS DELIBERATE. Redirect first, because it can carry `ok: true`. Then the
 * status, because a body is only worth reading once the server said it acted. Then the shape,
 * because a 200 that is not our JSON is not a save either.
 */
export function readPacketResponse(
  r: { ok: boolean; redirected: boolean },
  body: unknown,
): PacketOutcome {
  if (r.redirected) return { kind: 'refused', problem: SESSION_GONE }
  if (body === null || typeof body !== 'object') return { kind: 'refused', problem: UNREADABLE }
  const d = body as { packets?: unknown; message?: unknown }
  if (!r.ok) {
    // The server wrote a sentence for a person. Render THAT, never a generic one over it.
    return {
      kind: 'refused',
      problem: typeof d.message === 'string' && d.message ? d.message : 'That was not saved.',
    }
  }
  if (!Array.isArray(d.packets)) return { kind: 'refused', problem: SESSION_GONE }
  return { kind: 'saved', packets: d.packets as Packet[] }
}

/**
 * SAVED PACKETS. The persistence the documents pipeline was missing.
 *
 * The pipeline runs from the form's query, so a saved packet is that query plus a label. Save the one
 * on screen, reopen a saved one (which re-runs the real classifier against the stored inputs), or
 * delete it. When there is no lot loaded, the save row hides and the list stands alone.
 *
 * ==========================================================================================
 * A REFUSAL IS NOT A SAVE, AND THIS FILE USED TO RENDER THEM IDENTICALLY.
 * ==========================================================================================
 * On 2026-08-18 /api/packets was gated on `document.view`, the sensitive permission the
 * `read_only` role deliberately does not hold. `save()` read only `d.packets` and then cleared
 * the name field unconditionally, so a read_only operator pressing "Save this packet" got a 403
 * carrying a perfectly good sentence, saw the field empty and the button un-busy, and had every
 * reason to believe the packet was saved. Measured: 403,
 * `{"error":"not_permitted","message":"Your role, Read-only, does not include \"Open documents\"..."}`,
 * and `d.packets` undefined. The list simply did not move.
 *
 * So the STATUS is checked before the body is believed, the server's own sentence is rendered,
 * and the input is left alone on a refusal, because clearing it throws away the operator's typing
 * on top of losing their work. `remove()` had the identical shape and gets the identical fix.
 *
 * A FOLLOWED REDIRECT IS ALSO NOT A SUCCESS. When the gate cookie expires, an /api/* request is
 * answered with a 307 to /enter, `fetch` follows it, and /enter answers 200 with HTML: `r.ok` is
 * true on a request that saved nothing. `r.redirected` is checked for the same reason
 * `app/(app)/admin/AdminConsole.tsx` checks it, and unreadable JSON is treated as a failure
 * rather than as an empty list.
 */
export function PacketVault({
  currentNsn,
  stamp,
}: {
  currentNsn: string
  /**
   * THE STAMP THAT TURNS A SAVED QUERY INTO A SAVED DOCUMENT.
   *
   * Composed on the SERVER for the document currently on screen: the render instant, the fingerprint of
   * the assembled artifacts and their verdicts, the government feed day being served, and the source
   * archive digest. It is appended to the saved query, so reopening the packet can compare what comes
   * out now against what came out then and say which one the operator is looking at.
   *
   * IT IS NOT COMPUTED HERE. A fingerprint calculated in a browser would be a claim about the document
   * made by something that never assembled it.
   */
  stamp: Readonly<Record<string, string>>
}) {
  const [packets, setPackets] = useState<Packet[]>([])
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  /** The server's own refusal sentence, rendered verbatim. Null when the last write worked. */
  const [problem, setProblem] = useState<string | null>(null)
  /**
   * Whether the list on screen is a MEASUREMENT of the vault or an admission that it could not
   * be read. Three states, never two, because "empty" and "unknown" are different facts and the
   * screen must not print one over the other.
   */
  const [loaded, setLoaded] = useState<'loading' | 'read' | 'unreadable'>('loading')

  /*
   * READING THE LIST CAN FAIL, AND A FAILED READ IS NOT AN EMPTY VAULT.
   *
   * This used to answer every non-200 with `{ packets: [] }` and swallow a thrown parse in a bare
   * `.catch(() => {})`, so a gated, redirected or broken read rendered "No saved packets yet".
   * That sentence is a measurement, and it was being printed over an unknown. The unknown now
   * says so instead, in a line a person reads.
   */
  useEffect(() => {
    let live = true
    fetch('/api/packets')
      .then(async (r) => {
        const outcome = readPacketResponse(r, await r.json().catch(() => null))
        if (!live) return
        if (outcome.kind === 'refused') {
          setLoaded('unreadable')
          return
        }
        setPackets(outcome.packets)
        setLoaded('read')
      })
      .catch(() => {
        if (live) setLoaded('unreadable')
      })
    return () => {
      live = false
    }
  }, [])

  /**
   * One request path for both writes. Returns true ONLY when the server actually answered with a
   * saved list, so a caller can tell a save from a refusal without re-reading the response.
   */
  async function write(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true)
    setProblem(null)
    try {
      const r = await fetch(url, init)
      const body = await r.json().catch(() => null)
      const outcome = readPacketResponse(r, body)
      if (outcome.kind === 'refused') {
        setProblem(outcome.problem)
        return false
      }
      setPackets(outcome.packets)
      // The write answered with the whole list, so the list on screen is measured again.
      setLoaded('read')
      return true
    } catch {
      setProblem(UNREACHABLE)
      return false
    } finally {
      setBusy(false)
    }
  }

  /**
   * The query that reproduces this packet: what is in the address bar, plus the server's stamp of the
   * document on screen. An existing stamp is REPLACED rather than appended to, so reopening a saved
   * packet and saving it again records the new render rather than accumulating two contradictory
   * fingerprints in one URL.
   */
  function stampedQuery(): string {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
    for (const [key, value] of Object.entries(stamp)) {
      params.delete(key)
      if (value !== '') params.set(key, value)
    }
    return params.toString()
  }

  async function save() {
    if (!currentNsn) return
    const query = stampedQuery()
    const saved = await write('/api/packets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: label.trim() || `Packet for ${currentNsn}`, nsn: currentNsn, query }),
    })
    // Cleared ONLY on a real save. Emptying the field after a refusal reads as success and
    // throws away what the operator typed.
    if (saved) setLabel('')
  }

  async function remove(id: string) {
    await write(`/api/packets?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  return (
    <div className={s.vault}>
      {currentNsn ? (
        <div className={s.vaultSave}>
          <input
            className={s.vaultInput}
            placeholder={`Name this packet (for ${currentNsn})`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="Packet name"
          />
          <button type="button" className={s.vaultSaveBtn} onClick={save} disabled={busy}>
            Save this packet
          </button>
        </div>
      ) : null}

      {problem ? (
        <p className="banner banner--danger" role="alert">
          {problem}
        </p>
      ) : null}

      {loaded === 'unreadable' ? (
        <p className="banner banner--attention" role="status">
          {LIST_UNREADABLE}
        </p>
      ) : packets.length === 0 ? (
        <p className={s.hint}>
          {loaded === 'loading'
            ? 'Reading your saved packets\u2026'
            : 'No saved packets yet. Run a lot below, then save it here so it is ready before it is demanded.'}
        </p>
      ) : (
        <ul className={s.vaultList}>
          {packets.map((p) => (
            <li key={p.id} className={s.vaultItem}>
              <a className={s.vaultReopen} href={`/documents?${p.query}`}>
                {p.label}
              </a>
              {p.nsn ? <span className={`mono ${s.vaultNsn}`}>{p.nsn}</span> : null}
              <span className={s.vaultNsn}>{savedKindOf(p)}</span>
              <button type="button" className={s.vaultDel} onClick={() => remove(p.id)} disabled={busy} aria-label={`Delete ${p.label}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * WHAT A SAVED PACKET ACTUALLY IS, said on the row.
 *
 * Two kinds exist in the same list and they are not the same promise. A packet saved since the
 * document stamp landed carries a fingerprint, so reopening it can prove whether the artifact came
 * out the same way. One saved before that carries only the inputs, and reopening it regenerates
 * against today's world with no way to check. Both are useful; only one can be verified, so the row
 * says which it is rather than letting the older kind borrow the newer one's credibility.
 */
export function savedKindOf(p: { query: string; savedAt: number }): string {
  const day = p.savedAt > 0 ? new Date(p.savedAt).toISOString().slice(0, 10) : 'an unrecorded day'
  const stamped = new URLSearchParams(p.query).get('_fp')
  return stamped === null || stamped === ''
    ? `saved ${day}, inputs only, cannot be verified`
    : `saved ${day}, document fingerprinted`
}

/**
 * THE DAY'S QUEUE, ON PAPER. Print only, and display:none on screen, so nothing here is announced
 * twice by a screen reader.
 *
 * IT READS THE VAULT ITSELF rather than being handed the list, because the screen copy of the vault
 * lives inside the screen-only branch of the page and a print sheet cannot reach into it. The cost is
 * one extra read of a small JSON file; the alternative was printing a queue that might not match the
 * one on screen.
 *
 * A FAILED READ PRINTS AS A FAILED READ. An operator carrying a sheet that silently omitted three
 * packets is worse off than one carrying a sheet that says the queue could not be read.
 */
export function PacketQueuePrint({ heading }: { heading: React.ReactNode }) {
  const [packets, setPackets] = useState<Packet[]>([])
  const [loaded, setLoaded] = useState<'loading' | 'read' | 'unreadable'>('loading')

  useEffect(() => {
    let live = true
    fetch('/api/packets')
      .then(async (r) => {
        const outcome = readPacketResponse(r, await r.json().catch(() => null))
        if (!live) return
        if (outcome.kind === 'refused') {
          setLoaded('unreadable')
          return
        }
        setPackets(outcome.packets)
        setLoaded('read')
      })
      .catch(() => {
        if (live) setLoaded('unreadable')
      })
    return () => {
      live = false
    }
  }, [])

  return (
    <section className={s.page}>
      {heading}
      <h1 className={s.paperTitle}>The queue</h1>
      {loaded === 'unreadable' ? (
        <p className={s.paperBody}>{LIST_UNREADABLE}</p>
      ) : loaded === 'loading' ? (
        <p className={s.paperBody}>
          The queue had not finished loading when this page was printed, so it is not shown. That is a
          missing reading, not an empty queue.
        </p>
      ) : packets.length === 0 ? (
        <p className={s.paperBody}>No packets are saved. This is a measured empty queue, not a failed read.</p>
      ) : (
        <ul className={s.paperList}>
          {packets.map((p) => (
            <li key={p.id}>
              <strong>{p.label}</strong>
              {p.nsn ? <span> NSN {p.nsn}.</span> : <span> No stock number recorded.</span>} {savedKindOf(p)}.
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
