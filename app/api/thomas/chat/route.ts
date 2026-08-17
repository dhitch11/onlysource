import { NextRequest } from 'next/server'
import { gateOrJson } from '@/lib/session/require-gate'
import { thomasConfigured } from '@/lib/thomas/claude'
import { streamTurnWithTools, type WireMessage } from '@/lib/thomas/engine'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * THOMAS, TYPED.
 *
 * The chat panel talks to this. Gated, because Thomas reads the real book of business and can quote
 * live prices out of it: an ungated conversational endpoint would be a way to ask the platform for
 * its own intelligence without ever logging in.
 *
 * Streams newline-delimited JSON rather than Server-Sent Events. Both work; NDJSON was chosen
 * because the client needs to receive four different KINDS of thing (text, a tool starting, an
 * action for the browser to perform, and a correction that replaces what was already shown), and
 * one JSON object per line keeps that honest without inventing an event-name protocol on top of SSE.
 */
export async function POST(req: NextRequest) {
  const denied = await gateOrJson()
  if (denied) return denied

  if (!thomasConfigured()) {
    return Response.json(
      { error: 'ai_unconfigured', message: 'Thomas is not connected in this environment.' },
      { status: 503 },
    )
  }

  let body: { message?: unknown; history?: unknown; path?: unknown; surface?: unknown; selection?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'bad_request', message: 'Expected a JSON body.' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    // A contentless turn is refused rather than sent, so an empty box never bills a generation.
    return Response.json({ error: 'empty', message: 'Say something first.' }, { status: 400 })
  }
  if (message.length > 4000) {
    return Response.json({ error: 'too_long', message: 'That is longer than Thomas takes in one go.' }, { status: 400 })
  }

  const history: WireMessage[] = Array.isArray(body.history)
    ? (body.history as unknown[])
        .filter(
          (h): h is WireMessage =>
            typeof h === 'object' &&
            h !== null &&
            typeof (h as WireMessage).content === 'string' &&
            ((h as WireMessage).role === 'user' || (h as WireMessage).role === 'assistant'),
        )
        .slice(-20)
    : []

  const ctx = {
    path: typeof body.path === 'string' ? body.path.slice(0, 120) : undefined,
    surface: typeof body.surface === 'string' ? body.surface.slice(0, 80) : undefined,
    selection: typeof body.selection === 'string' ? body.selection.slice(0, 400) : undefined,
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      try {
        for await (const evt of streamTurnWithTools({ message, history, ctx })) {
          send(evt)
          if (evt.type === 'done') {
            log.info('thomas.turn', { model: evt.model, grounded: evt.grounded, surface: ctx.surface ?? '' })
          } else if (evt.type === 'error') {
            log.warn('thomas.turn_failed', { reason: evt.reason.slice(0, 120) })
          }
        }
      } catch (e) {
        // A thrown generator must still close the stream, or the panel spins forever on a dead socket.
        send({ type: 'error', reason: e instanceof Error ? e.message.slice(0, 160) : 'Thomas stopped unexpectedly.' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // Proxies that buffer will hold the whole reply and destroy the streaming feel.
      'X-Accel-Buffering': 'no',
    },
  })
}
