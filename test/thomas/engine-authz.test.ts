import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { role } from '@/lib/admin/permissions'
import type { ToolAccess } from '@/lib/thomas/authz'
import type { ToolUseBlock } from '@/lib/thomas/claude'

/**
 * THE REFUSAL REACHES THE FIREWALL, AND THE MODEL CANNOT TALK ITS WAY ROUND IT.
 *
 * ==========================================================================================
 * THE FAILURE THIS FILE EXISTS TO CATCH, WHICH IS NOT THE OBVIOUS ONE.
 * ==========================================================================================
 * Refusing the tool is the easy half, and `dispatch-order.test.ts` holds it. The half that
 * actually decides whether this lane shipped a control or a decoration is what happens NEXT.
 *
 * Thomas carries a large curated brain: the size of the no-quote buy, the count of scored stock
 * numbers, the escalation on the screw. Those figures are real, they are in the background notes
 * of every conversation, and they are therefore already in the allow-set before anybody says a
 * word. So a model whose tool just refused can answer the refused question anyway, from memory, in
 * the same confident register, with no tool anywhere in the trace and no number that looks invented.
 * The refusal would be perfect and the fact would still be delivered.
 *
 * That is why `guard` is told which classes were refused, and holds the WHOLE reply to figures a
 * tool returned in this conversation or the operator said themselves. This file scripts that exact
 * turn and asserts the reply is replaced.
 *
 * ==========================================================================================
 * WHAT IS REAL HERE AND WHAT IS NOT.
 * ==========================================================================================
 * Real: the permission map, the refusal, the tool dispatcher, the allow-set, the numeral firewall,
 * the retry, the fallback sentence. Substituted: `collectTurn`, because the alternative is billing
 * Anthropic to find out whether our own if-statement works, and a live model would not reliably
 * produce the exact violation being tested. The scripted replies are the ones the model actually
 * tends to produce, and `$47,102,283` is copied out of `PLATFORM_KNOWLEDGE` rather than invented,
 * so it is genuinely in the allow-set and genuinely NOT in the measured set.
 *
 * The data root is pointed at nothing on purpose, so no tool can contribute a real number. That
 * makes the measured set empty for every caller, which is the strictest possible reading of "the
 * figure did not come from a tool" and keeps the test about permissions rather than about the feed.
 */

/** A figure that IS in the curated background knowledge. Not invented: see lib/thomas/knowledge.ts. */
const A_KNOWLEDGE_FIGURE = '$47,102,283'

type Scripted = {
  ok: boolean
  text: string
  toolUses: ToolUseBlock[]
  stopReason: string
  model: string
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

const script = vi.hoisted(() => ({
  turns: [] as Array<{ text?: string; tools?: Array<{ name: string; input?: unknown }> }>,
  seen: [] as Array<{ system: string; messages: unknown[] }>,
}))

vi.mock('@/lib/thomas/claude', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/thomas/claude')>()
  let id = 0
  return {
    ...actual,
    collectTurn: async (input: { system: string; messages: unknown[] }): Promise<Scripted> => {
      script.seen.push({ system: input.system, messages: input.messages })
      const next = script.turns.shift() ?? { text: 'Nothing further.' }
      return {
        ok: true,
        text: next.text ?? '',
        toolUses: (next.tools ?? []).map((t) => ({
          type: 'tool_use' as const,
          id: `probe-${(id += 1)}`,
          name: t.name,
          input: t.input ?? {},
        })),
        stopReason: 'end_turn',
        model: 'scripted-model',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }
    },
  }
})

function asRole(key: string): ToolAccess {
  const r = role(key)
  if (!r) throw new Error(`No role "${key}" in the catalog, so this test is asserting nothing.`)
  return { held: r.permissions, kind: 'account', roleName: r.name }
}

const READ_ONLY = asRole('read_only')
const OPERATOR = asRole('operator')

const previousDataDir = process.env.ONLYSOURCE_DATA_DIR

beforeEach(() => {
  process.env.ONLYSOURCE_DATA_DIR = '/nonexistent/onlysource-data-for-this-test'
  script.turns = []
  script.seen = []
})

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.ONLYSOURCE_DATA_DIR
  else process.env.ONLYSOURCE_DATA_DIR = previousDataDir
})

const QUESTION = 'How big is the make-side no-quote buy?'

describe('a refused tool is recorded as refused, and never as work that was done', () => {
  it('keeps the refused tool out of toolsUsed and names the class instead', async () => {
    script.turns = [
      { tools: [{ name: 'goldmine_snapshot' }] },
      { text: 'Your role does not include cost and pricing, so I cannot put a figure on that here.' },
    ]
    const { runTurn } = await import('@/lib/thomas/engine')
    const result = await runTurn({
      message: QUESTION,
      history: [],
      mode: 'text',
      ctx: {},
      access: READ_ONLY,
    })

    expect(result.ok).toBe(true)
    // Nothing was read, so nothing may be drawn as provenance.
    expect(result.toolsUsed).toEqual([])
    expect(result.refusedTools).toEqual(['goldmine_snapshot'])
    expect(result.withheld).toEqual(['cost and pricing'])
    expect(result.grounded).toBe(true)
  })

  it('hands the refusal back to the model as the tool result, in words it can speak', async () => {
    script.turns = [
      { tools: [{ name: 'supplier_snapshot' }] },
      { text: 'That one is not mine to give you.' },
    ]
    const { runTurn } = await import('@/lib/thomas/engine')
    await runTurn({ message: 'Who holds it?', history: [], mode: 'text', ctx: {}, access: READ_ONLY })

    const secondRequest = JSON.stringify(script.seen[1]?.messages ?? [])
    expect(secondRequest).toContain('REFUSED BY PERMISSION')
    expect(secondRequest).toContain('supplier identities')
    expect(secondRequest).toContain('silent omission')
  })

  it('warns the model about the boundary BEFORE it reaches for a tool', async () => {
    script.turns = [{ text: 'Ask me something else.' }]
    const { runTurn } = await import('@/lib/thomas/engine')
    await runTurn({ message: QUESTION, history: [], mode: 'text', ctx: {}, access: READ_ONLY })

    const firstRequest = JSON.stringify(script.seen[0]?.messages ?? [])
    expect(firstRequest).toContain('[PERMISSIONS]')
    expect(firstRequest).toContain('supplier identities and cost and pricing')
  })
})

describe('THE CONTROL: the refused figure cannot be delivered from the background notes', () => {
  it('replaces an answer that quotes a curated figure after a refusal', async () => {
    script.turns = [
      { tools: [{ name: 'goldmine_snapshot' }] },
      { text: `The make-side buy is ${A_KNOWLEDGE_FIGURE} across those solicitations.` },
      // The single constrained retry, which the model fails the same way.
      { text: `Still about ${A_KNOWLEDGE_FIGURE}.` },
    ]
    const { runTurn } = await import('@/lib/thomas/engine')
    const { withheldEmpty } = await import('@/lib/thomas/grounding')
    const result = await runTurn({
      message: QUESTION,
      history: [],
      mode: 'text',
      ctx: {},
      access: READ_ONLY,
    })

    expect(result.text).not.toContain('47,102,283')
    expect(result.text).toBe(withheldEmpty(['cost and pricing']))
    expect(result.guardFailure).toBe('withheld')
    expect(result.grounded).toBe(false)
  })

  it('tells the model exactly what it did wrong on the retry, and does not call it untraceable', async () => {
    script.turns = [
      { tools: [{ name: 'goldmine_snapshot' }] },
      { text: `The make-side buy is ${A_KNOWLEDGE_FIGURE}.` },
      { text: 'I cannot give you that one.' },
    ]
    const { runTurn } = await import('@/lib/thomas/engine')
    await runTurn({ message: QUESTION, history: [], mode: 'text', ctx: {}, access: READ_ONLY })

    const retrySystem = script.seen[script.seen.length - 1]?.system ?? ''
    expect(retrySystem).toContain('THAT WAS WITHHELD FROM THIS OPERATOR')
    expect(retrySystem).toContain('cost and pricing')
    // The wrong sentence, and a false statement about our own data.
    expect(retrySystem).not.toContain('THE WRONG NUMBER FOR THE QUESTION')
  })

  it('the honest empty names the boundary and never claims the number is missing', async () => {
    const { withheldEmpty, HONEST_EMPTY } = await import('@/lib/thomas/grounding')
    const said = withheldEmpty(['cost and pricing'])
    expect(said).toContain('Your role does not include cost and pricing')
    expect(said).toContain('An owner can change your role')
    expect(said).not.toContain('cannot trace')
    expect(said).not.toBe(HONEST_EMPTY)
  })
})

/*
 * ==========================================================================================
 * THE POSITIVE CONTROL FOR THE CONTROL ABOVE.
 * ==========================================================================================
 * Byte-identical script, byte-identical reply, one thing changed: the caller holds the key. If the
 * firewall were simply refusing every curated figure, or the fallback were unconditional, this test
 * fails. It is what proves the replacement above is caused by the permission boundary and by
 * nothing else in the pipeline.
 */
describe('the same reply, by a caller who holds the key, is left alone', () => {
  it('an operator keeps the curated figure and the tool counts as used', async () => {
    script.turns = [
      { tools: [{ name: 'goldmine_snapshot' }] },
      { text: `The make-side buy is ${A_KNOWLEDGE_FIGURE} across those solicitations.` },
    ]
    const { runTurn } = await import('@/lib/thomas/engine')
    const result = await runTurn({
      message: QUESTION,
      history: [],
      mode: 'text',
      ctx: {},
      access: OPERATOR,
    })

    expect(result.refusedTools).toEqual([])
    expect(result.withheld).toEqual([])
    expect(result.toolsUsed).toEqual(['goldmine_snapshot'])
    expect(result.text).toContain('47,102,283')
    expect(result.grounded).toBe(true)
    expect(result.guardFailure).toBeUndefined()
  })

  it('and the operator is given no permission preamble at all', async () => {
    script.turns = [{ text: 'Here is the answer.' }]
    const { runTurn } = await import('@/lib/thomas/engine')
    await runTurn({ message: QUESTION, history: [], mode: 'text', ctx: {}, access: OPERATOR })
    expect(JSON.stringify(script.seen[0]?.messages ?? [])).not.toContain('[PERMISSIONS]')
  })
})

describe("the operator's own figures survive a refusal, because saying them back is quoting them", () => {
  it('lets Thomas repeat a number the operator put on the table', async () => {
    script.turns = [
      { tools: [{ name: 'goldmine_snapshot' }] },
      { text: 'You said 18,400 on that one, and I cannot check it against our pricing for you.' },
    ]
    const { runTurn } = await import('@/lib/thomas/engine')
    const result = await runTurn({
      message: 'We quoted 18,400 on that buy, is that in line?',
      history: [],
      mode: 'text',
      ctx: {},
      access: READ_ONLY,
    })

    expect(result.text).toContain('18,400')
    expect(result.grounded).toBe(true)
  })

  /*
   * AND A FIGURE THOMAS SAID EARLIER DOES NOT INHERIT. A role change has to take effect in the
   * conversation already open, not only in the next one, which is the same rule that makes a
   * deactivation take effect before the token expires.
   */
  it('does not let a figure from an earlier assistant turn stand in for a tool result', async () => {
    script.turns = [
      { tools: [{ name: 'goldmine_snapshot' }] },
      { text: `As I said, ${A_KNOWLEDGE_FIGURE}.` },
      { text: `It is ${A_KNOWLEDGE_FIGURE}.` },
    ]
    const { runTurn } = await import('@/lib/thomas/engine')
    const result = await runTurn({
      message: QUESTION,
      history: [{ role: 'assistant', content: `The make-side buy is ${A_KNOWLEDGE_FIGURE}.` }],
      mode: 'text',
      ctx: {},
      access: READ_ONLY,
    })

    expect(result.text).not.toContain('47,102,283')
    expect(result.guardFailure).toBe('withheld')
  })
})

describe('the spoken bridge, which holds no identity at all', () => {
  it('refuses every sensitive class and says so on the line', async () => {
    const { MACHINE_BRIDGE_ACCESS } = await import('@/lib/thomas/authz')
    script.turns = [
      { tools: [{ name: 'supplier_snapshot' }] },
      { text: 'I cannot give you supplier names on this line.' },
    ]
    const { runTurn } = await import('@/lib/thomas/engine')
    const result = await runTurn({
      message: 'Who holds that material?',
      history: [],
      mode: 'voice',
      ctx: {},
      access: MACHINE_BRIDGE_ACCESS,
    })

    expect(result.refusedTools).toEqual(['supplier_snapshot'])
    expect(result.withheld).toEqual(['supplier identities'])
    expect(JSON.stringify(script.seen[1]?.messages ?? [])).toContain('holds no account')
  })

  it('can still read the board out loud, so the voice line is not a dead end', async () => {
    const { MACHINE_BRIDGE_ACCESS } = await import('@/lib/thomas/authz')
    script.turns = [
      { tools: [{ name: 'portfolio_snapshot' }] },
      { text: 'The feed is not mounted here, so I cannot pull that right now.' },
    ]
    const { runTurn } = await import('@/lib/thomas/engine')
    const result = await runTurn({
      message: 'How many corners are on the forecast?',
      history: [],
      mode: 'voice',
      ctx: {},
      access: MACHINE_BRIDGE_ACCESS,
    })

    expect(result.refusedTools).toEqual([])
    expect(result.toolsUsed).toEqual(['portfolio_snapshot'])
  })
})

describe('the typed stream never shows a withheld figure and then takes it back', () => {
  it('suppresses the streamed text on a turn where a tool refused', async () => {
    script.turns = [
      { tools: [{ name: 'goldmine_snapshot' }] },
      { text: `The make-side buy is ${A_KNOWLEDGE_FIGURE}.` },
      { text: 'I cannot give you that one.' },
    ]
    const { streamTurnWithTools } = await import('@/lib/thomas/engine')
    const events: Array<Record<string, unknown>> = []
    for await (const e of streamTurnWithTools({
      message: QUESTION,
      history: [],
      ctx: {},
      access: READ_ONLY,
    })) {
      events.push(e as unknown as Record<string, unknown>)
    }

    const kinds = events.map((e) => e.type)
    // Not one token of the offending answer reaches the panel: a replace cannot un-read a number.
    expect(kinds).not.toContain('text')
    expect(kinds).toContain('refusal')
    expect(kinds).toContain('replace')

    const refusal = events.find((e) => e.type === 'refusal')!
    expect(refusal.tool).toBe('goldmine_snapshot')
    expect(refusal.classes).toEqual(['cost and pricing'])

    const replaced = events.find((e) => e.type === 'replace')!
    expect(String(replaced.text)).not.toContain('47,102,283')
    expect(replaced.failure).toBe('withheld')

    // A refusal is never reported as a tool that ran.
    expect(events.filter((e) => e.type === 'tool')).toEqual([])
  })

  /* The positive control: with no refusal, the stream still streams. */
  it('still streams normally for a caller who was refused nothing', async () => {
    script.turns = [
      { tools: [{ name: 'goldmine_snapshot' }] },
      { text: `The make-side buy is ${A_KNOWLEDGE_FIGURE} across those solicitations.` },
    ]
    const { streamTurnWithTools } = await import('@/lib/thomas/engine')
    const events: Array<Record<string, unknown>> = []
    for await (const e of streamTurnWithTools({
      message: QUESTION,
      history: [],
      ctx: {},
      access: OPERATOR,
    })) {
      events.push(e as unknown as Record<string, unknown>)
    }

    const kinds = events.map((e) => e.type)
    expect(kinds).toContain('text')
    expect(kinds).toContain('tool')
    expect(kinds).not.toContain('refusal')
    expect(kinds).not.toContain('replace')
  })

  /*
   * AND THE ANSWER THE REFUSAL WAS SUPPOSED TO PRODUCE IS NOT DRAWN AS A FIREWALL CATCH.
   *
   * This is the common case, not the edge: the model is told the boundary up front, the tool
   * refuses, and it answers honestly with no figure at all. That reply passes `guard`, and it was
   * held back from the stream only so no unchecked number could reach the screen. Emitting it as a
   * `replace` made the panel print "a figure in that answer could not be traced to the feed"
   * directly under the amber notice saying the data is fine and the role is the boundary. Two
   * contradicting sentences under one honest answer is the confusion this lane exists to end.
   */
  it('delivers a cleared answer as the answer, and never as a correction', async () => {
    script.turns = [
      { tools: [{ name: 'goldmine_snapshot' }] },
      { text: 'Your role does not include cost and pricing, so I cannot put a figure on that. An owner can grant it.' },
    ]
    const { streamTurnWithTools } = await import('@/lib/thomas/engine')
    const events: Array<Record<string, unknown>> = []
    for await (const e of streamTurnWithTools({
      message: QUESTION,
      history: [],
      ctx: {},
      access: READ_ONLY,
    })) {
      events.push(e as unknown as Record<string, unknown>)
    }

    const kinds = events.map((e) => e.type)
    expect(kinds).toContain('refusal')
    expect(kinds).toContain('text')
    expect(kinds).not.toContain('replace')
    expect(events.find((e) => e.type === 'done')!.grounded).toBe(true)
  })
})
