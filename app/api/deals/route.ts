import { NextRequest } from 'next/server'
import { gateOrJson } from '@/lib/session/require-gate'
import { readDeals, upsertDeal, removeDeal, type StoredDeal } from '@/lib/sales/deals-store'
import { systemClock } from '@/lib/time/clock'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** List the pipeline. Gated. */
export async function GET() {
  const denied = await gateOrJson()
  if (denied) return denied
  return Response.json({ deals: readDeals() })
}

/** Create or update a deal. Gated. A new deal without an id gets one. */
export async function POST(req: NextRequest) {
  const denied = await gateOrJson()
  if (denied) return denied
  let body: Partial<StoredDeal>
  try {
    body = (await req.json()) as Partial<StoredDeal>
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }
  const isNew = !(typeof body.id === 'string' && body.id)
  // A brand-new deal needs at least a title; refuse a contentless create rather than store an
  // "(untitled)" placeholder. Updates to an existing deal (id present) may be partial.
  if (isNew && !((body.title ?? '').trim())) {
    return Response.json({ error: 'empty_deal', message: 'A deal needs a title.' }, { status: 400 })
  }
  const id = isNew ? crypto.randomUUID() : (body.id as string)
  const deals = upsertDeal({ ...body, id }, systemClock.now())
  return Response.json({ deals, id })
}

/** Remove a deal. Gated. Body or query: { id }. */
export async function DELETE(req: NextRequest) {
  const denied = await gateOrJson()
  if (denied) return denied
  const url = new URL(req.url)
  let id = url.searchParams.get('id') ?? ''
  if (!id) {
    try {
      id = ((await req.json()) as { id?: string }).id ?? ''
    } catch {
      /* no body */
    }
  }
  if (!id) return Response.json({ error: 'no_id' }, { status: 400 })
  return Response.json({ deals: removeDeal(id) })
}
