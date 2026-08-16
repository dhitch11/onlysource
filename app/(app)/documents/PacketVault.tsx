'use client'

import { useEffect, useState } from 'react'
import s from './documents.module.css'

type Packet = { id: string; label: string; nsn: string; query: string; savedAt: number }

/**
 * SAVED PACKETS — the persistence the documents pipeline was missing.
 *
 * The pipeline runs from the form's query, so a saved packet is that query plus a label. Save the one
 * on screen, reopen a saved one (which re-runs the real classifier against the stored inputs), or
 * delete it. When there is no lot loaded, the save row hides and the list stands alone.
 */
export function PacketVault({ currentNsn }: { currentNsn: string }) {
  const [packets, setPackets] = useState<Packet[]>([])
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/packets')
      .then((r) => (r.ok ? r.json() : { packets: [] }))
      .then((d: { packets?: Packet[] }) => setPackets(d.packets ?? []))
      .catch(() => {})
  }, [])

  async function save() {
    if (!currentNsn) return
    setBusy(true)
    try {
      const query = typeof window !== 'undefined' ? window.location.search.replace(/^\?/, '') : ''
      const r = await fetch('/api/packets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || `Packet for ${currentNsn}`, nsn: currentNsn, query }),
      })
      const d = (await r.json()) as { packets?: Packet[] }
      if (d.packets) setPackets(d.packets)
      setLabel('')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      const r = await fetch(`/api/packets?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const d = (await r.json()) as { packets?: Packet[] }
      if (d.packets) setPackets(d.packets)
    } finally {
      setBusy(false)
    }
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

      {packets.length === 0 ? (
        <p className={s.hint}>No saved packets yet. Run a lot below, then save it here so it is ready before it is demanded.</p>
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
