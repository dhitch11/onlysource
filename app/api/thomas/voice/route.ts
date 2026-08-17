import { gateOrJson } from '@/lib/session/require-gate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * THE VOICE HANDSHAKE.
 *
 * Mints a short-lived signed WebSocket URL so the browser can open a conversation with the
 * ElevenLabs agent. The API key NEVER reaches the browser: this route calls ElevenLabs server-side
 * with the key and hands back only the signed URL, which expires on its own.
 *
 * Gated, and that gate is doing real work here. Minting is cheap but a conversation is not, and an
 * ungated mint endpoint is a way for anybody to spend this account's balance by opening sessions.
 * The estate's other voice surface protects the same endpoint with a PIN that ships in client
 * JavaScript; a real session cookie is strictly better, and it is already available on this app, so
 * it is what is used.
 */
export async function GET() {
  const denied = await gateOrJson()
  if (denied) return denied

  const key = process.env.ELEVENLABS_API_KEY
  const agentId = process.env.THOMAS_AGENT_ID
  if (!key || !agentId) {
    /*
     * An honest not-configured, not a broken one. The widget reads this and hides the voice button
     * while keeping typed chat fully working, rather than showing a control that cannot connect.
     * A media control that renders but cannot play is its own defect on this estate.
     */
    return Response.json(
      { ok: false, error: 'voice_unconfigured', message: 'Voice is not connected in this environment.' },
      { status: 503 },
    )
  }

  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(10_000) },
    )
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      return Response.json(
        { ok: false, error: 'mint_failed', status: r.status, message: detail.slice(0, 160) },
        { status: 502 },
      )
    }
    const d = (await r.json()) as { signed_url?: string }
    if (!d.signed_url) {
      return Response.json({ ok: false, error: 'no_url', message: 'No signed URL came back.' }, { status: 502 })
    }
    return Response.json(
      { ok: true, signedUrl: d.signed_url, agentId },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    return Response.json(
      { ok: false, error: 'mint_error', message: e instanceof Error ? e.message.slice(0, 160) : 'unknown' },
      { status: 502 },
    )
  }
}
