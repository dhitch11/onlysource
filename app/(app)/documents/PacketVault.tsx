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
export function PacketVault({ currentNsn }: { currentNsn: string }) {
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

  async function save() {
    if (!currentNsn) return
    const query = typeof window !== 'undefined' ? window.location.search.replace(/^\?/, '') : ''
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
