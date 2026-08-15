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
 */
const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-5'

export type AiResult = { ok: true; text: string } | { ok: false; reason: string }

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export async function generate(system: string, user: string, maxTokens = 900): Promise<AiResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, reason: 'AI is not configured in this environment.' }
  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      // Never hang a request thread forever.
      signal: AbortSignal.timeout(45_000),
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      return { ok: false, reason: `AI request failed (${resp.status}). ${detail.slice(0, 140)}` }
    }
    const data = (await resp.json()) as { content?: Array<{ type: string; text?: string }> }
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text as string)
      .join('\n')
      .trim()
    if (!text) return { ok: false, reason: 'AI returned an empty response.' }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 160) : 'AI request errored.' }
  }
}
