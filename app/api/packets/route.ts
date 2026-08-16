import { NextRequest } from 'next/server'
import { gateOrJson } from '@/lib/session/require-gate'
import { readPackets, savePacket, removePacket } from '@/lib/compliance/packets-store'
import { systemClock } from '@/lib/time/clock'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** List saved packets. Gated. */
export async function GET() {
  const denied = await gateOrJson()
  if (denied) return denied
  return Response.json({ packets: readPackets() })
}

/** Save a packet (label + nsn + the form query that reproduces it). Gated. */
export async function POST(req: NextRequest) {
  const denied = await gateOrJson()
  if (denied) return denied
  let body: { label?: string; nsn?: string; query?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }
  const nsn = (body.nsn ?? '').trim()
  const query = (body.query ?? '').replace(/^\?/, '').trim()
  // A packet with no stock number and no inputs is empty; refuse it rather than store junk.
  if (!nsn && !query) {
    return Response.json({ error: 'empty_packet', message: 'Nothing to save yet — run a lot first.' }, { status: 400 })
  }
  const packets = savePacket({ label: (body.label ?? '').trim(), nsn, query }, crypto.randomUUID(), systemClock.now())
  return Response.json({ packets })
}

/** Remove a saved packet. Gated. */
export async function DELETE(req: NextRequest) {
  const denied = await gateOrJson()
  if (denied) return denied
  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!id) return Response.json({ error: 'no_id' }, { status: 400 })
  return Response.json({ packets: removePacket(id) })
}
