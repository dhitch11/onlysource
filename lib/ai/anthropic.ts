/**
 * ANTHROPIC CLIENT — the language layer, never the number layer.
 *
 * Claude models run on the direct Anthropic API (estate rule: a Claude model in any slot goes to
 * the Anthropic Console API, never through a re-seller). The key is read from the environment at
 * call time and never appears in the repository — this file references it, it does not contain it.
 *
 * THE ONE RULE FOR EVERY PROMPT WE SEND: the model is handed ONLY numbers this build measured, and
 * is told in the system prompt that it may not invent a figure, a price, a date, or a claim beyond
 * what it was given. It writes the language; the data engine owns the facts. A brief that cannot be
 * grounded in the supplied data must say so, not fill the gap.
 *
 * ==========================================================================================
 * MODEL SELECTION: THE BEST MODEL FOR THE SLOT, AND NEVER A CHEAPER ONE.
 * ==========================================================================================
 * This client was pinned to `claude-sonnet-4-5`. Measured against the live key on 2026-08-16, the
 * account actually has claude-opus-5, claude-sonnet-5 and claude-fable-5, so the product was
 * writing its operator-facing judgement on a model two generations behind what it could reach.
 *
 * That is the failure the estate rule exists to prevent: quality quietly traded for nothing at all,
 * because a constant was written once and never revisited. The briefs are judgement and copy that
 * ships in front of somebody deciding what to bid, which is the top tier by that rule.
 *
 * EACH SLOT NAMES ITS OWN CHAIN, primary first. A chain is not a downgrade path for cost, it is a
 * survival path for an outage: if the primary is unavailable the operator gets a brief from the
 * next best model rather than an empty panel, AND THE RESPONSE SAYS WHICH MODEL SERVED IT, because
 * labelling output with a model that did not write it is its own small fabrication.
 */
const ENDPOINT = 'https://api.anthropic.com/v1/messages'

/**
 * The model chains, by slot.
 *
 * Verified present on the production key 2026-08-16 by listing /v1/models. A model named here that
 * the key cannot reach fails over to the next rather than failing the request, so adding an
 * aspirational entry is safe, and removing a working one is the only way to make this worse.
 */
export const MODEL_CHAINS = {
  /** A single stock number read end to end. Deep judgement over one dossier. */
  corner_brief: ['claude-opus-5', 'claude-sonnet-5', 'claude-sonnet-4-5'],
  /** The whole candidate book aggregated. Synthesis across many rows. */
  portfolio_brief: ['claude-opus-5', 'claude-sonnet-5', 'claude-sonnet-4-5'],
  /**
   * DELIVERABLES: the pursuit package memo and the supplier outreach draft. Copy that leaves
   * the building with the operator's name near it. The owner's ruling, verbatim: "If you're
   * creating deliverables, you should always use at least Opus 5 ... I would choose Opus 5
   * over Fable 5 ... because the results are very close." So Opus 5 first, and the survival
   * slot is the next best writer, never a budget model.
   */
  deliverable: ['claude-opus-5', 'claude-sonnet-5'],
} as const

export type AiSlot = keyof typeof MODEL_CHAINS

export type AiResult =
  | { ok: true; text: string; model: string; attempts: number }
  | { ok: false; reason: string; triedModels: string[] }

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/** The model this slot will try first. For rendering the honest state of a surface. */
export function primaryModel(slot: AiSlot): string {
  return MODEL_CHAINS[slot][0]
}

type OneShot =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; reason: string; retryable: boolean }

async function callOnce(
  key: string,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<OneShot> {
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
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      // Never hang a request thread forever.
      signal: AbortSignal.timeout(45_000),
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      /*
       * WHICH FAILURES ARE WORTH TRYING THE NEXT MODEL FOR.
       * 404 (this key cannot reach that model), 429 (rate limited) and 5xx (upstream trouble) are
       * about THIS model, so the next one in the chain may well work. A 400 is about OUR request
       * and would fail identically on every model, so retrying it just burns time and money.
       */
      const retryable = resp.status === 404 || resp.status === 429 || resp.status >= 500
      return { ok: false, reason: `AI request failed (${resp.status}). ${detail.slice(0, 140)}`, retryable }
    }
    const data = (await resp.json()) as {
      content?: Array<{ type: string; text?: string }>
      stop_reason?: string
    }
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text as string)
      .join('\n')
      .trim()
    /*
     * A REFUSAL IS AN ANSWER, NOT AN OUTAGE, AND IT IS NOT RETRYABLE.
     *
     * This function used to collapse every empty body into one retryable
     * "AI returned an empty response". Two things went wrong with that, both costing real
     * money on a live path. First, the operator could not tell a model declining to write
     * something from the vendor being down from the dossier having no facts in it — three
     * different situations, one sentence. Second, `generate()` treats retryable as
     * permission to walk the rest of the chain, so a refusal was re-sent to every model in
     * the slot and BILLED ONCE PER MODEL before failing anyway.
     *
     * Retrying a refusal on a weaker model is also the wrong thing to want: it is shopping
     * the same prompt around until something answers it, which is exactly the behaviour a
     * refusal signal exists to stop. So it fails here, once, in its own words.
     */
    if (data.stop_reason === 'refusal') {
      return {
        ok: false,
        reason: 'The model declined to answer this request. This is a refusal, not an outage.',
        retryable: false,
      }
    }
    if (!text) {
      return {
        ok: false,
        reason: `AI returned no text (stop_reason: ${data.stop_reason ?? 'unreported'}).`,
        retryable: true,
      }
    }
    /*
     * A response that hit the token ceiling is a CLIPPED DELIVERABLE, not a success. The
     * portfolio brief shipped live ending mid-word ("…remain at INSUFFICIEN") with a 200 and a
     * bill, because this function used to discard stop_reason. The caller decides what to do
     * with a truncated attempt (retry with headroom, then fail honestly); what it may never do
     * is serve it as finished.
     */
    return { ok: true, text, truncated: data.stop_reason === 'max_tokens' }
  } catch (e) {
    // A timeout or a network fault is about the attempt, not the request, so the next model is
    // worth trying.
    return {
      ok: false,
      reason: e instanceof Error ? e.message.slice(0, 160) : 'AI request errored.',
      retryable: true,
    }
  }
}

/**
 * Generate text for a slot, walking that slot's chain.
 *
 * Returns the model that ACTUALLY served the response. Callers that display or log a model name
 * must use this value and never the one they hoped for.
 */
export async function generate(
  system: string,
  user: string,
  maxTokens = 900,
  slot: AiSlot = 'corner_brief',
): Promise<AiResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, reason: 'AI is not configured in this environment.', triedModels: [] }

  const chain = MODEL_CHAINS[slot]
  const tried: string[] = []
  let lastReason = 'AI produced no response.'

  for (const model of chain) {
    tried.push(model)
    let attempt = await callOnce(key, model, system, user, maxTokens)
    if (attempt.ok && attempt.truncated) {
      /*
       * The clip is about the BUDGET, not the model, so the one retry stays on the same model
       * with doubled headroom rather than burning a chain slot. If it clips again the output
       * is running away from every stated length cap and is treated as a failure: a memo that
       * ends mid-word must never be served as finished, whatever it cost to generate.
       */
      attempt = await callOnce(key, model, system, user, maxTokens * 2)
    }
    if (attempt.ok) {
      if (!attempt.truncated) return { ok: true, text: attempt.text, model, attempts: tried.length }
      lastReason = 'The model ran past its token budget twice; a clipped deliverable is never served.'
      continue
    }
    lastReason = attempt.reason
    if (!attempt.retryable) break
  }

  return { ok: false, reason: lastReason, triedModels: tried }
}
