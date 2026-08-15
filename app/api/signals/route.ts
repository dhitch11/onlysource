import { gateOrJson } from '@/lib/session/require-gate'
import { computeSignals } from '@/lib/notify/signals'
import { readSettings, channelEnabled } from '@/lib/notify/settings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The in-app signal feed for the notification centre. Gated. Returns only the signals the operator
 * has left switched on for the in-app channel, so the bell obeys the same settings as the emails.
 */
export async function GET() {
  const denied = await gateOrJson()
  if (denied) return denied

  const set = computeSignals()
  const settings = readSettings()
  const signals = set.signals.filter((s) => channelEnabled(settings, s.kind, 'inApp'))
  return Response.json({ present: set.present, feedDay: set.feedDay, generatedAtMs: set.generatedAtMs, signals })
}
