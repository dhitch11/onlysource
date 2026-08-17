/**
 * THOMAS — THE REASONING LAYER.
 *
 * This is Thomas's own client, deliberately separate from `lib/ai/anthropic.ts`. That file is a
 * single-shot brief writer owned by another lane: one system string, one user string, no history,
 * no tools, no streaming. Thomas needs all four, and bending the brief client into a chat client
 * would have meant rewriting a file three other surfaces depend on. So this one is additive.
 *
 * The estate rule holds unchanged: a Claude model runs on the direct Anthropic Console API, never
 * through a re-seller. The key is read at call time and never appears in the repository.
 *
 * ==========================================================================================
 * MODEL SELECTION: THE BEST MODEL FOR THE SLOT, AND LATENCY IS PART OF QUALITY ON VOICE.
 * ==========================================================================================
 * Two slots, because Thomas answers in two very different situations.
 *
 * TEXT is where the hard questions land: why does this data exist, how do we actually make money
 * on it, why is our answer better than the tool the operator used last year. That is judgement in
 * front of somebody deciding what to bid, so it gets the top model.
 *
 * VOICE is a conversation with a human waiting through the silence. This estate has already paid
 * for the lesson that latency IS a quality dimension on a spoken line, not a cost dimension
 * (voice-duplex/VOICE-LOCK.md: four separate regressions, each from optimising a number blind to
 * the actual complaint). A brilliant answer that arrives three seconds late is a worse product
 * than a very good one that arrives in one. So voice leads with the fastest model that is still
 * genuinely strong, and its survival slot is faster still, because DEAD AIR IS THE WORST OUTCOME
 * on a phone-shaped surface. That is the one place in this file where a smaller model is the
 * correct answer, and it is chosen for the caller's experience, never for the bill.
 */
const ENDPOINT = 'https://api.anthropic.com/v1/messages'

/**
 * The model chains, by slot. Primary first; the rest are survival, not savings.
 *
 * Verified present on this key by listing /v1/models on 2026-08-17: claude-opus-5, claude-sonnet-5,
 * claude-fable-5, claude-opus-4-8/4-7/4-6, claude-sonnet-4-6, claude-haiku-4-5. The handoff document
 * in Downloads still claims this key is pinned to sonnet-4-5 and cannot reach Opus. That was true
 * once and is not true now, which is exactly why this was re-measured instead of inherited.
 */
export const THOMAS_CHAINS = {
  /** Typed conversation. Depth, argument, and the business reasoning. */
  thomas_chat: ['claude-opus-5', 'claude-sonnet-5', 'claude-sonnet-4-6'],
  /** Spoken conversation. Strong and fast, then faster, because silence is the failure mode. */
  thomas_voice: ['claude-sonnet-5', 'claude-haiku-4-5-20251001'],
} as const

export type ThomasSlot = keyof typeof THOMAS_CHAINS

export function thomasConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export function primaryModel(slot: ThomasSlot): string {
  return THOMAS_CHAINS[slot][0]
}

/* ------------------------------------------------------------------------------------------- */
/* WIRE TYPES                                                                                    */
/* ------------------------------------------------------------------------------------------- */

export type TextBlock = { type: 'text'; text: string }
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown }
export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

export type ThomasMessage = {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export type ToolSpec = {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

/** What a turn emits as it happens. The caller decides what to do with each. */
export type ThomasEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'done'; stopReason: string; model: string; usage: Usage }
  | { type: 'error'; reason: string; retryable: boolean }

export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/* ------------------------------------------------------------------------------------------- */
/* THE STREAM                                                                                    */
/* ------------------------------------------------------------------------------------------- */

type TurnInput = {
  system: string
  messages: ThomasMessage[]
  tools?: ToolSpec[]
  slot: ThomasSlot
  maxTokens?: number
  /** Overrides the chain entirely. Used only by the model picker in settings. */
  forceModel?: string
}

/**
 * Stream one turn, walking the slot's chain on a retryable failure.
 *
 * PROMPT CACHING IS NOT AN OPTIMISATION HERE, IT IS THE DIFFERENCE BETWEEN A USABLE AND AN
 * UNUSABLE VOICE AGENT. Thomas carries a large brain: every tool on the platform, where each
 * dataset comes from, how the business earns, and the named data traps he must never overclaim
 * past. That system prompt is stable across every turn of every conversation, so it is marked
 * with a cache breakpoint. On a hit the tokens are billed at a fraction and, far more importantly
 * for a spoken line, they are not re-processed, which is most of the time-to-first-token.
 *
 * The breakpoint sits at the END of the system block because a cache prefix must be identical to
 * hit. Anything that varies per turn (the page the operator is looking at, what they just asked)
 * belongs in `messages`, never in `system`, or the cache misses on every single turn and the
 * feature quietly becomes slower and more expensive than having no cache at all.
 */
export async function* streamTurn(input: TurnInput): AsyncGenerator<ThomasEvent> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    yield { type: 'error', reason: 'Thomas is not configured in this environment.', retryable: false }
    return
  }

  const chain = input.forceModel ? [input.forceModel] : THOMAS_CHAINS[input.slot]
  let lastReason = 'Thomas produced no response.'

  for (const model of chain) {
    const outcome = yield* attempt(key, model, input)
    if (outcome.ok) return
    lastReason = outcome.reason
    if (!outcome.retryable) break
    // A retryable failure that has ALREADY emitted text cannot be retried on the next model:
    // the caller has streamed a half-sentence to a browser or a TTS engine, and starting a
    // second answer behind it would splice two different replies together mid-thought.
    if (outcome.emitted) break
  }

  yield { type: 'error', reason: lastReason, retryable: false }
}

type Attempt =
  | { ok: true }
  | { ok: false; reason: string; retryable: boolean; emitted: boolean }

async function* attempt(
  key: string,
  model: string,
  input: TurnInput,
): AsyncGenerator<ThomasEvent, Attempt> {
  let emitted = false
  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens ?? 1400,
        stream: true,
        // The cache breakpoint. See the note on streamTurn for why it sits here and only here.
        system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
        messages: input.messages,
        ...(input.tools && input.tools.length ? { tools: input.tools } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!resp.ok || !resp.body) {
      const detail = await resp.text().catch(() => '')
      /*
       * Same triage as the brief client, and for the same reason. 404 means THIS key cannot reach
       * THIS model, 429 means this model is busy, 5xx means the upstream is unwell: all three are
       * about the model, so the next one in the chain is worth a try. A 400 is about our request
       * and would fail identically everywhere, so retrying it only burns time and money.
       */
      const retryable = resp.status === 404 || resp.status === 429 || resp.status >= 500
      return {
        ok: false,
        reason: `Thomas request failed (${resp.status}). ${detail.slice(0, 160)}`,
        retryable,
        emitted,
      }
    }

    let stopReason = 'end_turn'
    let usage: Usage = { ...EMPTY_USAGE }
    // Tool inputs arrive as a JSON string in fragments, so each open block accumulates its own.
    const building = new Map<number, { id: string; name: string; json: string }>()

    for await (const evt of sse(resp.body)) {
      if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
        building.set(evt.index as number, {
          id: String(evt.content_block.id),
          name: String(evt.content_block.name),
          json: '',
        })
      } else if (evt.type === 'content_block_delta') {
        const d = evt.delta ?? {}
        if (d.type === 'text_delta' && d.text) {
          emitted = true
          yield { type: 'text', delta: String(d.text) }
        } else if (d.type === 'input_json_delta') {
          const b = building.get(evt.index as number)
          if (b) b.json += String(d.partial_json ?? '')
        }
      } else if (evt.type === 'content_block_stop') {
        const b = building.get(evt.index as number)
        if (b) {
          building.delete(evt.index as number)
          let parsed: unknown = {}
          /*
           * An unparseable tool input is a REAL possibility, not a theoretical one: a stream that
           * is cut mid-argument leaves truncated JSON behind. Emitting the call anyway with an
           * empty object would run the tool with no arguments, which for a lookup means answering
           * about the wrong stock number entirely. So it degrades to an empty input and the tool
           * layer validates and refuses, rather than guessing at what was being asked.
           */
          try {
            parsed = b.json ? JSON.parse(b.json) : {}
          } catch {
            parsed = {}
          }
          yield { type: 'tool_use', id: b.id, name: b.name, input: parsed }
        }
      } else if (evt.type === 'message_delta') {
        if (evt.delta?.stop_reason) stopReason = String(evt.delta.stop_reason)
        if (evt.usage) usage.output = Number(evt.usage.output_tokens ?? usage.output)
      } else if (evt.type === 'message_start') {
        const u = evt.message?.usage ?? {}
        usage = {
          input: Number(u.input_tokens ?? 0),
          output: Number(u.output_tokens ?? 0),
          cacheRead: Number(u.cache_read_input_tokens ?? 0),
          cacheWrite: Number(u.cache_creation_input_tokens ?? 0),
        }
      } else if (evt.type === 'error') {
        return {
          ok: false,
          reason: String(evt.error?.message ?? 'stream error').slice(0, 160),
          retryable: true,
          emitted,
        }
      }
    }

    /*
     * A REFUSAL IS AN ANSWER, NOT AN OUTAGE. Walking the chain on a refusal is shopping the same
     * prompt around until something answers it, which is the behaviour the signal exists to stop.
     */
    if (stopReason === 'refusal') {
      return {
        ok: false,
        reason: 'Thomas declined to answer that. This is a refusal, not an outage.',
        retryable: false,
        emitted,
      }
    }

    yield { type: 'done', stopReason, model, usage }
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message.slice(0, 160) : 'Thomas request errored.',
      retryable: true,
      emitted,
    }
  }
}

/* ------------------------------------------------------------------------------------------- */
/* SSE                                                                                           */
/* ------------------------------------------------------------------------------------------- */

type SseEvent = {
  type: string
  index?: number
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string }
  content_block?: { type?: string; id?: string; name?: string }
  message?: { usage?: Record<string, number> }
  usage?: Record<string, number>
  error?: { message?: string }
}

/**
 * Parse an Anthropic SSE body into events.
 *
 * The buffer is split on a blank line rather than on every newline because a single SSE frame is
 * multi-line and its `data:` payload is itself JSON that may contain newlines. Splitting per line
 * looks correct against short test fixtures and then corrupts long tool arguments in production,
 * which is the kind of defect that only ever appears under real load.
 */
async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut = buffer.indexOf('\n\n')
      while (cut !== -1) {
        const frame = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        const line = frame.split('\n').find((l) => l.startsWith('data:'))
        if (line) {
          const payload = line.slice(5).trim()
          if (payload && payload !== '[DONE]') {
            try {
              yield JSON.parse(payload) as SseEvent
            } catch {
              /* a frame we cannot parse is skipped; one bad frame never kills a live turn */
            }
          }
        }
        cut = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/* ------------------------------------------------------------------------------------------- */
/* COLLECTED FORM                                                                                */
/* ------------------------------------------------------------------------------------------- */

export type CollectedTurn = {
  ok: boolean
  text: string
  toolUses: ToolUseBlock[]
  stopReason: string
  model: string
  usage: Usage
  reason?: string
}

/** Run a turn to completion. For callers that cannot stream, and for tests. */
export async function collectTurn(input: TurnInput): Promise<CollectedTurn> {
  let text = ''
  const toolUses: ToolUseBlock[] = []
  let stopReason = 'end_turn'
  let model = primaryModel(input.slot)
  let usage: Usage = { ...EMPTY_USAGE }

  for await (const evt of streamTurn(input)) {
    if (evt.type === 'text') text += evt.delta
    else if (evt.type === 'tool_use') toolUses.push({ type: 'tool_use', id: evt.id, name: evt.name, input: evt.input })
    else if (evt.type === 'done') {
      stopReason = evt.stopReason
      model = evt.model
      usage = evt.usage
    } else if (evt.type === 'error') {
      return { ok: false, text, toolUses, stopReason, model, usage, reason: evt.reason }
    }
  }
  return { ok: true, text: text.trim(), toolUses, stopReason, model, usage }
}
