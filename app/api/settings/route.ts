import { NextRequest } from 'next/server'
import { gateOrJson } from '@/lib/session/require-gate'
import { readSettings, writeSettings, type AlertSettings } from '@/lib/notify/settings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Read the current alert settings. Gated. */
export async function GET() {
  const denied = await gateOrJson()
  if (denied) return denied
  return Response.json(readSettings())
}

/** Save alert settings. Gated. The store coerces unknown/invalid shapes to safe defaults. */
export async function POST(req: NextRequest) {
  const denied = await gateOrJson()
  if (denied) return denied
  let body: AlertSettings
  try {
    body = (await req.json()) as AlertSettings
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }
  return Response.json(writeSettings(body))
}
