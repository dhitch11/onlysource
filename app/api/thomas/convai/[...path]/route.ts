import { NextRequest } from 'next/server'
import { runTurn, type WireMessage, type TurnContext } from '@/lib/thomas/engine'
import { MACHINE_BRIDGE_ACCESS } from '@/lib/thomas/authz'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * THE ELEVENLABS BRIDGE — Thomas's spoken turn.
 *
 * ElevenLabs Conversational AI does speech to text, text to speech, and turn taking. It does NOT do
 * the thinking: the reasoning slot stays Claude on the direct Anthropic API, per the estate rule. So
 * the agent is configured with a "custom LLM" pointing here, and ElevenLabs calls this endpoint as
 * though it were OpenAI's chat completions API. This file is that costume.
 *
 * WHY A CATCH-ALL ROUTE. ElevenLabs appends `/chat/completions` to whatever base URL it is given, and
 * it is not configurable. A fixed route would 404 on the real request shape. The catch-all accepts
 * whatever it appends and answers the same way.
 *
 * ==========================================================================================
 * WHY THIS ROUTE IS PUBLIC, AND WHY THAT IS NOT A HOLE.
 * ==========================================================================================
 * ElevenLabs' servers call this. They carry no gate cookie and never will, so the session gate cannot
 * apply, and it is allowlisted in proxy.ts alongside the alerts route for exactly that reason.
 *
 * The control that replaces it is a bearer secret held in the ElevenLabs workspace and checked here on
 * every request. It FAILS CLOSED in both directions: no secret configured on the server means every
 * request is refused, rather than every request being waved through. That default is the entire point.
 * A gate that opens when it is misconfigured is not a gate, and this estate has shipped that defect
 * before: a page whose bytes reached the browser while a client-side overlay pretended to hide them.
 *
 * ==========================================================================================
 * AND THAT SECRET PROVES WHICH SERVICE IS CALLING. IT PROVES NOTHING ABOUT WHO IS ON THE PHONE.
 * ==========================================================================================
 * There is no cookie on this path and there never will be, so there is no person to resolve and no
 * role to read. The `OPERATOR:` line this route parses out of the system text arrives inside a
 * client-written message: it is display context for the conversation and it is NOT an identity
 * claim. Trusting it would mean anybody holding the bearer secret could name themselves the owner
 * in a string and read every margin in the book down a phone line.
 *
 * So this is the MOST RESTRICTED caller in the system. `MACHINE_BRIDGE_ACCESS` holds every
 * non-sensitive operator permission and no sensitive one, DERIVED from the permission catalog
 * rather than listed, so a permission marked sensitive tomorrow is excluded the moment it exists.
 * Thomas can still take somebody through the thesis and read the board's live counts out loud. He
 * cannot name a supplier, quote a price, open a document, or export anything, for anybody, ever, on
 * this line, and when he is asked he says exactly that instead of going quiet.
 */

function unauthorized() {
  return Response.json({ error: 'unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  const secret = process.env.CONVAI_LLM_SECRET || ''
  const header = req.headers.get('authorization') || ''
  const provided = header.replace(/^Bearer\s+/i, '').trim()
  /*
   * FAIL CLOSED. An unset secret refuses everything. The alternative, treating "no secret" as "no
   * check", turns a deployment mistake into an open endpoint that answers questions about the real
   * book of business, and it would do it silently, with a 200.
   */
  if (!secret || provided !== secret) return unauthorized()

  let body: {
    messages?: Array<{ role?: string; content?: unknown }>
    stream?: boolean
    user_id?: string
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const incoming = Array.isArray(body.messages) ? body.messages : []
  const flat = incoming
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: typeof m.content === 'string' ? m.content : '',
      raw: m.role,
    }))
    .filter((m) => m.content.trim())

  // The last user turn is what Thomas is answering; everything before it is history.
  const lastUserIx = [...flat].reverse().findIndex((m) => m.raw !== 'assistant' && m.raw !== 'system')
  const cutAt = lastUserIx === -1 ? flat.length : flat.length - 1 - lastUserIx
  const message = flat[cutAt]?.content ?? ''
  const history: WireMessage[] = flat
    .slice(0, cutAt)
    .filter((m) => m.raw !== 'system')
    .map((m) => ({ role: m.role, content: m.content }))

  if (!message.trim()) {
    return completion(body.stream === true, "I did not catch that. Say it again?", 'none')
  }

  /*
   * PAGE CONTEXT ON THE SPOKEN PATH. The widget stamps the current route into the first system
   * message before opening the socket, so Thomas knows what the operator is looking at while they
   * talk. Parsed out of the system text rather than a query parameter, because ElevenLabs does not
   * forward query parameters to a custom LLM.
   */
  const systemText = incoming
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n')
  const ctx: TurnContext = {
    surface: (systemText.match(/SURFACE:\s*([^\n|]+)/) || [])[1]?.trim(),
    path: (systemText.match(/ROUTE:\s*([^\n|]+)/) || [])[1]?.trim(),
    operator: (systemText.match(/OPERATOR:\s*([^\n|]+)/) || [])[1]?.trim(),
  }

  const result = await runTurn({ message, history, mode: 'voice', ctx, access: MACHINE_BRIDGE_ACCESS })

  if (!result.ok) {
    log.warn('thomas.voice_failed', { reason: (result.reason ?? '').slice(0, 120) })
    /*
     * DEAD AIR IS THE WORST OUTCOME ON A LIVE LINE. A failed turn still answers, in words, so the
     * operator hears something human instead of silence while they wait for a reply that is not
     * coming. It says nothing it cannot back up.
     */
    return completion(body.stream === true, "Something went wrong pulling that up on my end. Ask me again?", 'none')
  }

  log.info('thomas.voice_turn', {
    model: result.model,
    grounded: result.grounded,
    tools: result.toolsUsed.join(','),
    actions: result.actions.map((a) => a.name).join(','),
  })
  if (result.refusedTools.length) {
    log.warn('thomas.tool_refused', {
      outcome: 'denied',
      gate: 'permission',
      reason: `machine-bridge ${result.refusedTools.join(',')}: ${result.withheld.join(', ')}`,
    })
  }

  return completion(body.stream === true, result.text, result.model)
}

/** Wear the OpenAI chat-completions shape, streaming or not, because that is what the caller expects. */
function completion(stream: boolean, text: string, model: string) {
  const now = Math.floor(Date.now() / 1000)
  const id = `chatcmpl-thomas-${now}`
  if (stream) {
    const chunk = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created: now,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`
    const sse = chunk({ role: 'assistant', content: text }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n'
    return new Response(sse, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
    })
  }
  return Response.json({
    id,
    object: 'chat.completion',
    created: now,
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  })
}
