/**
 * THE TURN ENGINE — one conversational turn, end to end.
 *
 * Shared deliberately by both paths. The typed widget and the spoken ElevenLabs bridge run THIS
 * function, so Thomas cannot drift into being two different people depending on how you reached him.
 * The estate has already paid for that lesson once: a speculative pass on the voice line carried its
 * own hardcoded persona, so the eager reply and the main brain were literally different characters.
 * One engine, two front doors.
 *
 * THE LOOP. Ask the model. If it calls server tools, run them, feed the results back, and ask again.
 * Client tools are NOT executed here: they are collected and handed to the browser, because only the
 * browser can change a route or move a filter. The loop is bounded, because a model that keeps
 * calling tools forever is a hang, and on a voice line a hang is dead air.
 *
 * THE FIREWALL RUNS ON THE FINISHED TEXT, not on the stream. That is a real tradeoff and it was made
 * on purpose: you cannot un-say a token that has already been spoken aloud. So the spoken path buys
 * correctness with a little latency, and the typed path streams for feel and re-checks at the end.
 */
import { collectTurn, streamTurn, type ThomasMessage, type ContentBlock, type ToolUseBlock, type ThomasSlot } from './claude'
import { systemPrefix, turnContext } from './persona'
import { PLATFORM_KNOWLEDGE } from './knowledge'
import { ALL_TOOLS, isServerTool, runServerTool } from './tools'
import { buildAllowSet, addNumbers, guard, constraintFor, HONEST_EMPTY, type AllowSet } from './grounding'

/** How many times the model may call tools before we stop and make it answer. */
const MAX_TOOL_ROUNDS = 4

export type ClientAction = { name: string; input: Record<string, unknown> }

export type TurnContext = {
  path?: string
  surface?: string
  operator?: string
  selection?: string
}

export type TurnResult = {
  ok: boolean
  text: string
  /** What the browser should do: navigate, open a dossier, set a filter. */
  actions: ClientAction[]
  /** Which server tools actually ran. Shown in the UI so the operator sees the work. */
  toolsUsed: string[]
  model: string
  grounded: boolean
  reason?: string
}

/** History as the widget stores it. Kept plain so it survives a JSON round trip. */
export type WireMessage = { role: 'user' | 'assistant'; content: string }

export async function runTurn(opts: {
  message: string
  history: WireMessage[]
  mode: 'voice' | 'text'
  ctx: TurnContext
}): Promise<TurnResult> {
  const slot: ThomasSlot = opts.mode === 'voice' ? 'thomas_voice' : 'thomas_chat'
  const system = systemPrefix()

  /*
   * THE ALLOW-SET STARTS FROM THE CURATED KNOWLEDGE AND FROM WHAT THE OPERATOR SAID.
   * Their own words matter: if they say "we quoted eighteen hundred on that", Thomas has to be able
   * to say eighteen hundred back without the firewall calling it an invention.
   */
  const allow: AllowSet = buildAllowSet([
    PLATFORM_KNOWLEDGE,
    opts.message,
    ...opts.history.map((h) => h.content),
  ])

  const messages: ThomasMessage[] = [
    ...opts.history.slice(-12).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: `${turnContext({ ...opts.ctx, mode: opts.mode })}\n\n${opts.message}` },
  ]

  const actions: ClientAction[] = []
  const toolsUsed: string[] = []
  let model = ''

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const lastRound = round === MAX_TOOL_ROUNDS
    const turn = await collectTurn({
      system,
      messages,
      // On the final round the tools are withheld, which forces an answer instead of a fifth call.
      tools: lastRound ? undefined : ALL_TOOLS,
      slot,
      maxTokens: opts.mode === 'voice' ? 400 : 1600,
    })
    model = turn.model
    if (!turn.ok) return { ok: false, text: '', actions, toolsUsed, model, grounded: false, reason: turn.reason }

    const serverCalls = turn.toolUses.filter((t) => isServerTool(t.name))
    const clientCalls = turn.toolUses.filter((t) => !isServerTool(t.name))

    for (const c of clientCalls) {
      actions.push({ name: c.name, input: (c.input ?? {}) as Record<string, unknown> })
    }

    if (!serverCalls.length) {
      // The model is done reaching for data. Check what it wants to say, then say it.
      const checked = await enforce(turn.text, allow, { system, messages, slot, mode: opts.mode })
      return { ok: true, text: checked.text, actions, toolsUsed, model, grounded: checked.grounded }
    }

    // Record the assistant's tool-calling turn verbatim, then answer each call.
    messages.push({ role: 'assistant', content: assistantBlocks(turn.text, turn.toolUses) })
    const results: ContentBlock[] = []
    for (const call of serverCalls) {
      toolsUsed.push(call.name)
      const outcome = await runServerTool(call.name, (call.input ?? {}) as Record<string, unknown>)
      // Everything a tool measured becomes speakable. This is how real numbers get through.
      addNumbers(allow, outcome.numbers)
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: outcome.text,
        ...(outcome.isError ? { is_error: true } : {}),
      })
    }
    /*
     * CLIENT TOOL CALLS NEED A RESULT TOO. The API rejects a turn where a tool_use has no matching
     * tool_result, so a browser-side action left unanswered would fail the NEXT request with a 400
     * that looks like a bug in the model. They are acknowledged as dispatched.
     */
    for (const call of clientCalls) {
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: 'Dispatched to the operator\'s screen. It is happening now; speak as though they can see it.',
      })
    }
    messages.push({ role: 'user', content: results })
  }

  return {
    ok: true,
    text: "I went round a few times on that without landing it. Ask me again a different way and I will get there.",
    actions,
    toolsUsed,
    model,
    grounded: true,
  }
}

/** Rebuild the assistant turn as content blocks so the tool call survives into the next request. */
function assistantBlocks(text: string, uses: ToolUseBlock[]): ContentBlock[] {
  const blocks: ContentBlock[] = []
  if (text.trim()) blocks.push({ type: 'text', text })
  for (const u of uses) blocks.push(u)
  return blocks
}

/**
 * The firewall, with its single retry.
 *
 * One regeneration under an explicit constraint, then an honest empty. Not two, not a loop: if the
 * model could not ground it when told exactly which figures were invented, more attempts are just
 * shopping the same prompt around until something slips through, which is the behaviour the check
 * exists to stop.
 */
async function enforce(
  text: string,
  allow: AllowSet,
  cfg: { system: string; messages: ThomasMessage[]; slot: ThomasSlot; mode: 'voice' | 'text' },
): Promise<{ text: string; grounded: boolean }> {
  if (!text.trim()) return { text: HONEST_EMPTY, grounded: false }
  const first = guard(text, allow)
  if (first.ok) return { text, grounded: true }

  const retry = await collectTurn({
    system: cfg.system + constraintFor(first.offenders),
    messages: cfg.messages,
    slot: cfg.slot,
    maxTokens: cfg.mode === 'voice' ? 400 : 1600,
  })
  if (retry.ok && retry.text.trim()) {
    const second = guard(retry.text, allow)
    if (second.ok) return { text: retry.text, grounded: true }
  }
  return { text: HONEST_EMPTY, grounded: false }
}

/**
 * The typed path streams, because a chat panel that sits blank for four seconds feels broken even
 * when it is working. Tool rounds are resolved first (they produce no visible text anyway), and only
 * the FINAL answer is streamed. The firewall then re-checks the completed text, and a violation
 * replaces what was streamed rather than leaving an ungrounded figure on screen.
 */
export async function* streamTurnWithTools(opts: {
  message: string
  history: WireMessage[]
  ctx: TurnContext
}): AsyncGenerator<
  | { type: 'action'; action: ClientAction }
  | { type: 'tool'; name: string }
  | { type: 'text'; delta: string }
  | { type: 'replace'; text: string }
  | { type: 'done'; model: string; grounded: boolean }
  | { type: 'error'; reason: string }
> {
  const system = systemPrefix()
  const allow: AllowSet = buildAllowSet([
    PLATFORM_KNOWLEDGE,
    opts.message,
    ...opts.history.map((h) => h.content),
  ])
  const messages: ThomasMessage[] = [
    ...opts.history.slice(-12).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: `${turnContext({ ...opts.ctx, mode: 'text' })}\n\n${opts.message}` },
  ]

  let model = ''
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const lastRound = round === MAX_TOOL_ROUNDS
    const probe = await collectTurn({
      system,
      messages,
      tools: lastRound ? undefined : ALL_TOOLS,
      slot: 'thomas_chat',
      maxTokens: 1600,
    })
    model = probe.model
    if (!probe.ok) {
      yield { type: 'error', reason: probe.reason ?? 'Thomas could not answer.' }
      return
    }

    const serverCalls = probe.toolUses.filter((t) => isServerTool(t.name))
    for (const c of probe.toolUses.filter((t) => !isServerTool(t.name))) {
      yield { type: 'action', action: { name: c.name, input: (c.input ?? {}) as Record<string, unknown> } }
    }

    if (!serverCalls.length) {
      /*
       * Stream the settled answer. The text is already known from the probe, so this re-emits it in
       * pieces rather than paying for a second generation: identical words, streamed feel, one bill.
       */
      const text = probe.text
      for (const chunk of chunkForStream(text)) yield { type: 'text', delta: chunk }
      const verdict = guard(text, allow)
      if (!verdict.ok) {
        const fixed = await enforce(text, allow, { system, messages, slot: 'thomas_chat', mode: 'text' })
        yield { type: 'replace', text: fixed.text }
        yield { type: 'done', model, grounded: fixed.grounded }
        return
      }
      yield { type: 'done', model, grounded: true }
      return
    }

    messages.push({ role: 'assistant', content: assistantBlocks(probe.text, probe.toolUses) })
    const results: ContentBlock[] = []
    for (const call of serverCalls) {
      yield { type: 'tool', name: call.name }
      const outcome = await runServerTool(call.name, (call.input ?? {}) as Record<string, unknown>)
      addNumbers(allow, outcome.numbers)
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: outcome.text,
        ...(outcome.isError ? { is_error: true } : {}),
      })
    }
    for (const call of probe.toolUses.filter((t) => !isServerTool(t.name))) {
      results.push({ type: 'tool_result', tool_use_id: call.id, content: 'Dispatched to the operator\'s screen.' })
    }
    messages.push({ role: 'user', content: results })
  }
  yield { type: 'error', reason: 'Thomas kept reaching for data without landing an answer.' }
}

/** Split on word boundaries so the panel fills like typing rather than in one block. */
function* chunkForStream(text: string): Generator<string> {
  const parts = text.split(/(\s+)/)
  let buf = ''
  for (const p of parts) {
    buf += p
    if (buf.length >= 18) {
      yield buf
      buf = ''
    }
  }
  if (buf) yield buf
}

export { streamTurn }
