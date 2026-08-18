import { NextRequest } from 'next/server'
import { gateOrJson } from '@/lib/session/require-gate'
import { requirePermission } from '@/lib/session/authz'
import { readContacted, toggleContacted } from '@/lib/suppliers/contacted'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** The set of already-contacted supplier CAGEs. Gated. */
export async function GET() {
  const denied = await gateOrJson()
  if (denied) return denied
  return Response.json({ contacted: readContacted() })
}

/** Toggle a supplier's contacted state. Requires `supplier.pursue`. Body: { cage }. */
export async function POST(req: NextRequest) {
  const denied = await requirePermission('supplier.pursue')
  if (denied) return denied
  let body: { cage?: unknown }
  try {
    body = (await req.json()) as { cage?: unknown }
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }
  const cage = typeof body.cage === 'string' ? body.cage.trim() : ''
  if (!cage) return Response.json({ error: 'no_cage' }, { status: 400 })
  return Response.json({ contacted: toggleContacted(cage) })
}
