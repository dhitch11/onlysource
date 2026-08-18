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
 *
 * ==========================================================================================
 * THE CALLER'S PERMISSIONS ARRIVE HERE, AND EVERY TOOL CALL IS MADE ON THEIR BEHALF.
 * ==========================================================================================
 * `access` is a REQUIRED argument on both entry points, never an optional one with a default.
 * Whatever a default resolved to would silently become the permission every forgotten call site
 * ran with, and the forgotten call site is the one nobody reviews as a security change. Making it
 * required turns that mistake into a compile error, which is where it belongs. It is resolved once
 * per request by the route, from the gate token, and it is never re-derived in here: a second
 * identity resolver is a second answer to the same question and the two drift the day somebody is
 * deactivated.
 *
 * A REFUSED TOOL SHRINKS THE TURN'S FACT SET, AND THE FIREWALL IS TOLD. Everything a tool returns
 * joins the speakable set; a tool that refused returns nothing, so nothing joins. That alone is not
 * enough, because the model carries the curated background knowledge and would happily answer the
 * refused half from memory, in the same confident register, with no tool anywhere in the trace. So
 * the classes that were refused are carried into `guard`, which then holds the WHOLE reply to the
 * measured set. A permission boundary that the model can talk its way around is a diagram, not a
 * control.
 */
import { collectTurn, streamTurn, type ThomasMessage, type ContentBlock, type ToolUseBlock, type ThomasSlot } from './claude'
import { systemPrefix, turnContext } from './persona'
import { PLATFORM_KNOWLEDGE } from './knowledge'
import { ALL_TOOLS, isServerTool, runServerTool } from './tools'
import { withheldClasses, type ToolAccess } from './authz'
import {
  buildAllowSet,
  addNumbers,
  guard,
  constraintFor,
  withheldEmpty,
  HONEST_EMPTY,
  type AllowSet,
} from './grounding'

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
  /**
   * Which server tools actually RAN. A refused call is deliberately not in here: the interface
   * draws this list as "read live", and printing a tool that never read anything would put a
   * provenance claim under an answer that has no provenance.
   */
  toolsUsed: string[]
  /** Which server tools refused, by name, for the log and for the interface. */
  refusedTools: string[]
  /**
   * The sensitive classes this caller could not read on this turn, said the way Thomas says them.
   * Non-empty means the operator is looking at a permission boundary and must be told so in those
   * words: a silent omission teaches them to read a boundary as a gap in our data.
   */
  withheld: string[]
  model: string
  grounded: boolean
  /** Why the answer was replaced, when it was. Not interchangeable, so not collapsed to a boolean. */
  guardFailure?: 'ungrounded' | 'unmeasured' | 'withheld'
  reason?: string
}

/** History as the widget stores it. Kept plain so it survives a JSON round trip. */
export type WireMessage = { role: 'user' | 'assistant'; content: string }

export async function runTurn(opts: {
  message: string
  history: WireMessage[]
  mode: 'voice' | 'text'
  ctx: TurnContext
  /** WHO is asking, and what they hold. Resolved by the route from the gate token. Required. */
  access: ToolAccess
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
  /*
   * MEASURED is the strict set: figures a tool returned during THIS turn, and nothing else. It
   * starts empty and only a real engine call fills it. A question about the current state of the
   * book is answered from this set or not at all. See the note on `guard` for the two audit
   * failures that made a second set necessary.
   */
  const measured: AllowSet = new Set()
  /*
   * SPOKEN is what the OPERATOR put on the table, and only that: their own turns, never Thomas's.
   * Saying their own figure back to them is quoting them, not disclosing anything, so it survives
   * the strict check that a refusal turns on. Assistant turns are excluded on purpose. A figure
   * Thomas said earlier is a figure he was allowed to say earlier, and inheriting it through the
   * transcript would let a role change take effect everywhere except in the conversation already
   * open, which is the same shape of defect as a token that outlives a deactivation.
   */
  const spoken: AllowSet = operatorNumbers(opts.message, opts.history)

  const withheld = withheldClasses(opts.access)
  const messages: ThomasMessage[] = [
    ...opts.history.slice(-12).map((h) => ({ role: h.role, content: h.content })),
    {
      role: 'user' as const,
      content: `${turnContext({ ...opts.ctx, mode: opts.mode, withheld })}\n\n${opts.message}`,
    },
  ]

  const actions: ClientAction[] = []
  const toolsUsed: string[] = []
  const refusedTools: string[] = []
  /* The classes a tool actually refused on THIS turn. Drives the firewall and the interface. */
  const refusedClasses = new Set<string>()
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
    if (!turn.ok) {
      return {
        ok: false,
        text: '',
        actions,
        toolsUsed,
        refusedTools,
        withheld: [...refusedClasses],
        model,
        grounded: false,
        reason: turn.reason,
      }
    }

    const serverCalls = turn.toolUses.filter((t) => isServerTool(t.name))
    const clientCalls = turn.toolUses.filter((t) => !isServerTool(t.name))

    for (const c of clientCalls) {
      actions.push({ name: c.name, input: (c.input ?? {}) as Record<string, unknown> })
    }

    if (!serverCalls.length) {
      // The model is done reaching for data. Check what it wants to say, then say it.
      const checked = await enforce(turn.text, allow, {
        system,
        messages,
        slot,
        mode: opts.mode,
        measured,
        question: opts.message,
        spoken,
        withheld: [...refusedClasses],
      })
      return {
        ok: true,
        text: checked.text,
        actions,
        toolsUsed,
        refusedTools,
        withheld: [...refusedClasses],
        model,
        grounded: checked.grounded,
        ...(checked.failure ? { guardFailure: checked.failure } : {}),
      }
    }

    // Record the assistant's tool-calling turn verbatim, then answer each call.
    messages.push({ role: 'assistant', content: assistantBlocks(turn.text, turn.toolUses) })
    const results: ContentBlock[] = []
    for (const call of serverCalls) {
      const outcome = await runServerTool(call.name, (call.input ?? {}) as Record<string, unknown>, opts.access)
      if (outcome.refused) {
        /*
         * A REFUSED CALL IS NOT A CALL THAT RAN. It reads nothing, so it contributes no numbers,
         * it never joins `toolsUsed`, and the classes it could not read are recorded so the
         * firewall and the interface both see the smaller fact set this turn actually has.
         */
        refusedTools.push(call.name)
        for (const c of outcome.refused.classes) refusedClasses.add(c)
      } else {
        toolsUsed.push(call.name)
      }
      // Everything a tool measured becomes speakable, and joins the STRICT set as well, which is
      // what makes it a valid answer to a question about the book as it stands right now.
      addNumbers(allow, outcome.numbers)
      addNumbers(measured, outcome.numbers)
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
    refusedTools,
    withheld: [...refusedClasses],
    model,
    grounded: true,
  }
}

/**
 * Every figure the OPERATOR themselves put into this conversation, and nothing else.
 *
 * Split out because both entry points need the identical rule and a second copy of it would be a
 * second place to get the assistant/user distinction wrong.
 */
function operatorNumbers(message: string, history: WireMessage[]): AllowSet {
  return buildAllowSet([message, ...history.filter((h) => h.role === 'user').map((h) => h.content)])
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
  cfg: {
    system: string
    messages: ThomasMessage[]
    slot: ThomasSlot
    mode: 'voice' | 'text'
    measured?: AllowSet
    question?: string
    spoken?: AllowSet
    withheld?: readonly string[]
  },
): Promise<{ text: string; grounded: boolean; failure?: 'ungrounded' | 'unmeasured' | 'withheld' }> {
  const withheld = cfg.withheld ?? []
  /*
   * AN EMPTY REPLY AFTER A REFUSAL IS THE SILENT OMISSION, AND IT IS THE WORST OUTCOME AVAILABLE.
   * `HONEST_EMPTY` says a figure could not be traced back to the feed, which would be a false
   * statement about our own data: the data is fine, the caller may not read it. So the fallback
   * after a refusal names the boundary instead, and says who can change it.
   */
  if (!text.trim()) {
    return withheld.length
      ? { text: withheldEmpty(withheld), grounded: false, failure: 'withheld' }
      : { text: HONEST_EMPTY, grounded: false }
  }
  const checkOpts = { measured: cfg.measured, question: cfg.question, spoken: cfg.spoken, withheld }
  const first = guard(text, allow, checkOpts)
  if (first.ok) return { text, grounded: true }

  /*
   * The retry keeps the TOOLS available. The original single-shot retry withheld them, which was
   * fine for an invented figure but actively wrong for the "right number, wrong question" failure:
   * the only correct fix there is to go and read the real one, and a model with no tools cannot.
   *
   * A `withheld` failure is the one case where the tools are withheld ON PURPOSE. The correct
   * answer there contains no figure for the refused class at all, and handing back the same tool
   * that just refused invites another round of the same refusal while the operator waits. Every
   * figure the turn is allowed to keep is already in `measured` and already in the transcript as a
   * tool result, so the retry has everything it legitimately needs.
   */
  const retry = await collectTurn({
    system: cfg.system + constraintFor(first.offenders, first.kind, withheld),
    messages: cfg.messages,
    tools: first.kind === 'unmeasured' ? ALL_TOOLS : undefined,
    slot: cfg.slot,
    maxTokens: cfg.mode === 'voice' ? 400 : 1600,
  })
  if (retry.ok && retry.text.trim()) {
    const second = guard(retry.text, allow, checkOpts)
    if (second.ok) return { text: retry.text, grounded: true, failure: first.kind }
  }
  return withheld.length
    ? { text: withheldEmpty(withheld), grounded: false, failure: 'withheld' }
    : { text: HONEST_EMPTY, grounded: false, failure: first.kind }
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
  /** WHO is asking, and what they hold. Resolved by the route from the gate token. Required. */
  access: ToolAccess
}): AsyncGenerator<
  | { type: 'action'; action: ClientAction }
  | { type: 'tool'; name: string }
  /*
   * A REFUSAL IS ITS OWN EVENT, and that is the whole point of this lane on the interface side.
   * It is not a `tool` (nothing was read), it is not an `error` (nothing went wrong), and it is
   * not silence (silence is what teaches an operator that our data is thin). It is a boundary,
   * and the panel draws it as one, in its own words, at its own confidence.
   */
  | { type: 'refusal'; tool: string; classes: string[] }
  | { type: 'text'; delta: string }
  | { type: 'replace'; text: string; failure?: 'ungrounded' | 'unmeasured' | 'withheld' }
  | { type: 'done'; model: string; grounded: boolean }
  | { type: 'error'; reason: string }
> {
  const system = systemPrefix()
  const allow: AllowSet = buildAllowSet([
    PLATFORM_KNOWLEDGE,
    opts.message,
    ...opts.history.map((h) => h.content),
  ])
  const measured: AllowSet = new Set()
  const spoken: AllowSet = operatorNumbers(opts.message, opts.history)
  const refusedClasses = new Set<string>()
  const withheld = withheldClasses(opts.access)
  const messages: ThomasMessage[] = [
    ...opts.history.slice(-12).map((h) => ({ role: h.role, content: h.content })),
    {
      role: 'user' as const,
      content: `${turnContext({ ...opts.ctx, mode: 'text', withheld })}\n\n${opts.message}`,
    },
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
      const checkOpts = {
        measured,
        question: opts.message,
        spoken,
        withheld: [...refusedClasses],
      }
      /*
       * A REFUSAL SUPPRESSES THE STREAM. Normally the settled text is streamed for feel and
       * re-checked at the end, and a violation is replaced on screen. That is fine for an invented
       * figure the operator never asked for. It is NOT fine for a figure their role withholds:
       * streaming it first would put the withheld number on their screen, and a `replace` a second
       * later does not un-read it. So on a turn where a tool refused, the check runs first and only
       * the settled answer is shown.
       */
      const streamed = refusedClasses.size === 0
      if (streamed) for (const chunk of chunkForStream(text)) yield { type: 'text', delta: chunk }
      const verdict = guard(text, allow, checkOpts)
      /*
       * A HELD-BACK ANSWER THAT PASSED IS DELIVERED, NOT "REPLACED". It was withheld from the
       * stream only because a tool refused, and the check has now cleared it, so nothing is being
       * taken back. The panel draws `replace` as the numeral firewall catching a figure and prints
       * "a figure could not be traced to the feed" underneath, which on this turn is a false
       * statement about our own data, sitting directly under the amber notice that says the data is
       * fine and the role is the boundary. Those two lines contradicting each other is the exact
       * confusion this lane exists to end, so the settled text is emitted as the answer.
       */
      if (verdict.ok && !streamed) {
        for (const chunk of chunkForStream(text)) yield { type: 'text', delta: chunk }
        yield { type: 'done', model, grounded: true }
        return
      }
      if (!verdict.ok) {
        const fixed = await enforce(text, allow, {
          system,
          messages,
          slot: 'thomas_chat',
          mode: 'text',
          measured,
          question: opts.message,
          spoken,
          withheld: [...refusedClasses],
        })
        yield {
          type: 'replace',
          text: fixed.text,
          ...(fixed.failure ? { failure: fixed.failure } : {}),
        }
        yield { type: 'done', model, grounded: fixed.grounded }
        return
      }
      yield { type: 'done', model, grounded: true }
      return
    }

    messages.push({ role: 'assistant', content: assistantBlocks(probe.text, probe.toolUses) })
    const results: ContentBlock[] = []
    for (const call of serverCalls) {
      const outcome = await runServerTool(call.name, (call.input ?? {}) as Record<string, unknown>, opts.access)
      if (outcome.refused) {
        for (const c of outcome.refused.classes) refusedClasses.add(c)
        yield { type: 'refusal', tool: call.name, classes: [...outcome.refused.classes] }
      } else {
        yield { type: 'tool', name: call.name }
      }
      addNumbers(allow, outcome.numbers)
      addNumbers(measured, outcome.numbers)
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
