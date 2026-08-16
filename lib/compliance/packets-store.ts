import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * THE PACKET VAULT — saved compliance packets, so paperwork built once is there when the clock starts.
 *
 * The documents pipeline runs entirely from the form's query parameters, so a saved packet is just
 * that query plus a label and the stock number it is for. Reopening one re-runs the real classifier,
 * pre-flight, and assembler against the stored inputs; nothing about the verdict is cached, only the
 * inputs. One JSON file in the gitignored state directory that survives deploys.
 */

export type StoredPacket = {
  id: string
  label: string
  nsn: string
  /** The form query string (without leading '?') that reproduces the packet. */
  query: string
  savedAt: number
}

function stateDir(): string {
  return process.env.ONLYSOURCE_STATE_DIR || path.join(process.cwd(), '.state')
}
function filePath(): string {
  return path.join(stateDir(), 'packets.json')
}

function coerce(raw: unknown): StoredPacket | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  return {
    id: r.id,
    label: typeof r.label === 'string' && r.label.trim() ? r.label : 'Untitled packet',
    nsn: typeof r.nsn === 'string' ? r.nsn : '',
    query: typeof r.query === 'string' ? r.query : '',
    savedAt: typeof r.savedAt === 'number' ? r.savedAt : 0,
  }
}

export function readPackets(): StoredPacket[] {
  try {
    const p = filePath()
    if (!existsSync(p)) return []
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(raw) ? raw.map(coerce).filter((x): x is StoredPacket => x !== null).sort((a, b) => b.savedAt - a.savedAt) : []
  } catch {
    return []
  }
}

function write(packets: StoredPacket[]): void {
  const dir = stateDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath(), JSON.stringify(packets, null, 2), 'utf8')
}

export function savePacket(input: { label: string; nsn: string; query: string }, id: string, nowMs: number): StoredPacket[] {
  const packet = coerce({ ...input, id, savedAt: nowMs })
  if (!packet) return readPackets()
  const next = [packet, ...readPackets().filter((p) => p.id !== id)]
  write(next)
  return next
}

export function removePacket(id: string): StoredPacket[] {
  const next = readPackets().filter((p) => p.id !== id)
  write(next)
  return next
}
