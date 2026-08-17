import 'server-only'
import { egressFetch, type EgressResponse } from '@/lib/egress/client'

/**
 * THE DIBBS CONSENT SESSION. T7 mints and holds it; T2 consumes a consented client and never
 * performs the consent POST. If both mint, they fight; if neither does, the ingest 302s into a
 * banner and reads it as data.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * MEASURED FROM THE REAL CAPTURED BANNERS, NOT FROM THE RESEARCH NOTE.
 *
 * The handoff and the research say the viewstate is "split across 24 hidden fields". The two
 * real captures in `test/fixtures/dibbs/` carry **THREE**: `__VIEWSTATE`,
 * `__VIEWSTATEGENERATOR` and `__EVENTVALIDATION`. Three is what the form actually posts.
 *
 * Also measured, and each one breaks the handshake if missed:
 *   - The form action is RELATIVE (`../../../dodwarning.aspx?goto=...`) and must be resolved
 *     against the banner's own URL.
 *   - The submit button `butAgree=OK` must be posted. ASP.NET fires the server-side click
 *     handler off the button's presence in the body; without it the postback is ignored and
 *     you get the banner back, forever, with no error.
 *   - The form declares `accept-charset="ISO-8859-1"`.
 *   - Both captures are EXACTLY 9,152 bytes with DIFFERENT sha256, because the action embeds
 *     the target path. This is why nothing in this connector may key on length or on a hash
 *     of the whole body.
 *
 * The extractor below still reads EVERY hidden input generically rather than the three by
 * name. Not because 24 was right, but because hardcoding three field names would break silently
 * on the day DLA adds a fourth, and reading them all costs nothing.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

export type DibbsHost = 'dibbs' | 'dibbs2'

/** The two hosts hold consent state SEPARATELY. One session for both is the bug. */
export const DIBBS_ORIGINS: Record<DibbsHost, string> = {
  dibbs: 'https://dibbs.bsm.dla.mil',
  dibbs2: 'https://dibbs2.bsm.dla.mil',
}

export class ConsentError extends Error {
  readonly code: 'no_form' | 'no_fields' | 'post_failed' | 'still_blocked' | 'waf_blocked'
  constructor(code: ConsentError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'ConsentError'
  }
}

/**
 * THE INTERCEPTION MARKERS, measured from the pages this host actually serves in place of
 * data. The DoD banner carries 'Warning and Consent' (twice in each of the two archived
 * captures), a `__VIEWSTATE`, the `butAgree` button and a `dodwarning` form action. The F5
 * ASM block page carries 'Request Rejected'. A fixed-width index or a zip carries none of
 * these in its first bytes.
 *
 * WHY THIS EXISTS (defect fixed 2026-08-17): the F5 WAF can serve the banner AT the file
 * URL, with HTTP 200 AND with session cookies set. The two guards this module used to rely
 * on, a cookie count in `mint` and a /dodwarning.aspx finalUrl test in `request`, are BOTH
 * silent in that case, and 9,152 bytes of HTML flow onward labelled as a fetch that worked.
 */
const INTERCEPTION_MARKERS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'Request Rejected', re: /request rejected/i },
  { name: 'Warning and Consent', re: /warning and consent/i },
  { name: 'dodwarning form action', re: /dodwarning/i },
  { name: '__VIEWSTATE field', re: /__viewstate/i },
  { name: 'butAgree consent button', re: /butagree/i },
]

/** The first marker present in an HTML head, or null when none is. */
export function findInterceptionMarker(headHtml: string): string | null {
  for (const m of INTERCEPTION_MARKERS) {
    if (m.re.test(headHtml)) return m.name
  }
  return null
}

export type ConsentForm = {
  /** Absolute, resolved against the banner URL. */
  action: string
  /** Every hidden field, plus the agree button. Values are opaque and are never logged. */
  fields: Record<string, string>
}

/**
 * Parse the consent form out of a banner page. PURE, so it is tested against the real captured
 * bytes with no network.
 *
 * Deliberately refuses rather than returning a partial form: posting an incomplete viewstate
 * gets the banner back with HTTP 200, which is indistinguishable from success to anything that
 * checks a status code.
 */
export function extractConsentForm(html: string, bannerUrl: string): ConsentForm {
  const form = /<form[^>]*\bmethod=["']?post["']?[^>]*>/i.exec(html)
  if (!form) {
    throw new ConsentError('no_form', 'the consent page carried no POST form')
  }
  const actionMatch = /\baction=["']([^"']+)["']/i.exec(form[0])
  if (!actionMatch?.[1]) {
    throw new ConsentError('no_form', 'the consent form carried no action')
  }
  // Relative action, resolved against the page it was served from.
  const action = new URL(decodeHtml(actionMatch[1]), bannerUrl).toString()

  const fields: Record<string, string> = {}
  const inputRe = /<input\b[^>]*>/gi
  for (const tag of html.match(inputRe) ?? []) {
    const type = attr(tag, 'type')?.toLowerCase()
    const name = attr(tag, 'name')
    if (!name) continue
    if (type === 'hidden') {
      fields[name] = decodeHtml(attr(tag, 'value') ?? '')
    } else if (type === 'submit') {
      // The agree button. Its presence in the body is what fires the handler.
      fields[name] = decodeHtml(attr(tag, 'value') ?? 'OK')
    }
  }

  if (Object.keys(fields).length === 0) {
    throw new ConsentError('no_fields', 'the consent form carried no postable fields')
  }
  return { action, fields }
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tag)
  return m?.[1]
}

/** Minimal entity decode. Viewstate is base64 but the action carries encoded characters. */
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}


/**
 * Wrap an egress response as a consented one, adding the small-object convenience.
 *
 * HEADERS ARE MATERIALISED WITH `Object.fromEntries(res.headers.entries())`, never with a
 * cast. A fetch `Headers` object typed as `Record<string, string>` compiles clean and then
 * every bracket read (`headers['content-type']`) returns undefined at runtime, because a
 * Headers instance has no string-keyed own properties. The downstream banner assertion in
 * `lib/ingest/sources/dibbs-fetch.ts` reads exactly that key, so the cast silently amputated
 * the content-type leg of the one gate this connector exists to feed. `entries()` lowercases
 * every name, which is why that consumer's lowercase read works.
 */
function toConsented(res: EgressResponse): ConsentedResponse {
  let taken = false
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    finalUrl: res.finalUrl,
    contentType: res.contentType,
    body: res.body,
    async bytes() {
      if (taken) {
        // A stream is consumable once. Saying so is better than returning an empty buffer
        // that reads as "the government sent us nothing".
        throw new Error('the response body has already been consumed')
      }
      taken = true
      if (!res.body) return Buffer.alloc(0)
      const chunks: Uint8Array[] = []
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) chunks.push(value)
      }
      return Buffer.concat(chunks)
    },
  }
}

/**
 * A response whose body was consumed to inspect it for an interception page and turned out
 * to be worth passing through. The bytes are handed onward so nothing is fetched twice; the
 * stream leg is spent, which is fine for the small HTML-labelled objects this path handles.
 */
function toBuffered(res: EgressResponse, bytes: Buffer): ConsentedResponse {
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    finalUrl: res.finalUrl,
    contentType: res.contentType,
    body: null,
    bytes: async () => bytes,
  }
}

/** Cookies held per host. NEVER logged: a session cookie is a credential. */
type Session = { cookies: Map<string, string>; mintedAt: number }

const SESSIONS = new Map<DibbsHost, Session>()

function cookieHeader(s: Session): string {
  return [...s.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

function absorbCookies(s: Session, res: EgressResponse): void {
  // `getSetCookie` returns each header separately, which a joined string cannot express.
  const raw = res.headers.getSetCookie?.() ?? []
  for (const line of raw) {
    const pair = line.split(';', 1)[0] ?? ''
    const eq = pair.indexOf('=')
    if (eq > 0) s.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
}

export type ConsentedResponse = {
  status: number
  /**
   * Materialised from the fetch `Headers` via `entries()`, keys lowercased. A plain record
   * rather than a `Headers` instance so this type structurally satisfies the ingest
   * pipeline's `ConsentedClient` contract, whose consumers index by string key.
   */
  headers: Record<string, string>
  /** AFTER redirects. How an expired session is told from a real page. */
  finalUrl: string
  contentType: string | null
  /**
   * THE DEFAULT, and deliberately the one that requires no decision. The monthly PublogDVD
   * archive is 1,733,717,329 bytes; buffering it is an out-of-memory crash, not a slow path.
   */
  body: ReadableStream<Uint8Array> | null
  /**
   * The convenience for small objects, per @T2's amendment. Correct for the 439 KB daily
   * index, wrong for the catalog.
   *
   * It is a METHOD rather than a property on purpose: a property would be materialised for
   * every response including the 1.73 GB one, which is exactly the accident streaming exists
   * to prevent. Calling it consumes `body`, so it is one or the other, never both.
   */
  bytes(): Promise<Buffer>
}

export interface ConsentedClient {
  host: DibbsHost
  get(path: string, opts?: { range?: { start: number; end?: number } }): Promise<ConsentedResponse>
  postForm(path: string, form: Record<string, string>): Promise<ConsentedResponse>
  /** Mint a fresh session. The ONE retry, so an expired consent is never a silent loop. */
  refresh(): Promise<void>
}

/**
 * Mint a consent session for one host by performing the real handshake: request the target,
 * follow the 302 to the banner, read its form, post the agreement.
 *
 * NO SHORTCUT AND NO SCRAPING AROUND IT. The consent is a legal interstitial and the POST is
 * how a user agrees to it. This performs the same agreement a person performs.
 */
async function mint(host: DibbsHost, probePath: string): Promise<Session> {
  const session: Session = { cookies: new Map(), mintedAt: Date.now() }
  const origin = DIBBS_ORIGINS[host]

  // 1. Ask for the target. An unconsented host 302s to /dodwarning.aspx?goto=<target>,
  //    but the F5 can ALSO serve an interception page AT the requested URL with HTTP 200
  //    and cookies set, so the redirect is one signal, never the only one.
  const first = await egressFetch(new URL(probePath, origin).toString())
  absorbCookies(session, first)

  let bannerHtml: string | null = null
  let bannerUrl = first.finalUrl

  if (/dodwarning\.aspx/i.test(first.finalUrl)) {
    bannerHtml = await readText(first)
  } else if ((first.contentType ?? '').toLowerCase().includes('text/html')) {
    // HTML at a non-warning URL: the archive listing legitimately is one, an interception
    // page is not. Read it and let the MARKERS decide, not the transport.
    const text = await readText(first, 262_144)
    const marker = findInterceptionMarker(text.slice(0, 65_536))
    if (marker === 'Request Rejected') {
      throw new ConsentError(
        'waf_blocked',
        `${host} served the F5 'Request Rejected' block page at ${first.finalUrl}. ` +
          `This is rate enforcement, not a consent problem; a new session will not fix it. ` +
          `Back off before the next attempt.`,
      )
    }
    if (marker && /butagree/i.test(text)) {
      // The consent banner served AT the requested URL, no redirect. Agree to THIS form.
      bannerHtml = text
      bannerUrl = first.finalUrl
    }
    // Any other HTML page (the directory listing) means consent already holds.
  } else {
    await first.body?.cancel().catch(() => {})
  }

  if (!bannerHtml) return session

  const form = extractConsentForm(bannerHtml, bannerUrl)

  // 2. Post the agreement, carrying every field plus the agree button. egressFetch follows
  //    the post-consent redirect internally, so this response can BE the target object;
  //    only its head is read (for the WAF check) and the rest is cancelled, because the
  //    target can be a 57 MB zip and the caller is about to fetch it properly anyway.
  const res = await egressFetch(form.action, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(session),
      Referer: bannerUrl,
    },
    body: new URLSearchParams(form.fields).toString(),
  })
  absorbCookies(session, res)
  if ((res.contentType ?? '').toLowerCase().includes('text/html')) {
    const postHead = await readText(res, 65_536)
    if (/request rejected/i.test(postHead)) {
      throw new ConsentError(
        'waf_blocked',
        `the F5 WAF answered the consent POST for ${host} with its 'Request Rejected' page. ` +
          `Back off before the next attempt.`,
      )
    }
  } else {
    await res.body?.cancel().catch(() => {})
  }

  if (session.cookies.size === 0) {
    throw new ConsentError('post_failed', 'the consent POST returned no session cookie')
  }
  return session
}

/** Buffer a whole response body. Used only on HTML-labelled answers, which are pages. */
async function readBytes(res: EgressResponse): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/**
 * Read a response body as ISO-8859-1 text (the charset the consent form declares), up to
 * `maxBytes` when given. The cap exists so a probe that unexpectedly reaches a large object
 * inspects its head and cancels the rest instead of buffering it whole.
 */
async function readText(res: EgressResponse, maxBytes?: number): Promise<string> {
  if (!res.body) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.length
      if (maxBytes !== undefined && total >= maxBytes) {
        await reader.cancel().catch(() => {})
        break
      }
    }
  }
  const text = Buffer.concat(chunks).toString('latin1')
  return maxBytes !== undefined ? text.slice(0, maxBytes) : text
}

/**
 * Get a consented client for a host.
 *
 * The retry discipline is the important part: a request that lands on the consent page triggers
 * exactly ONE refresh and retry. If it lands there again, it throws `still_blocked` rather than
 * looping, because a silent retry loop against a .mil host is how an account gets locked.
 */
export async function getConsentedClient(
  host: DibbsHost,
  probePath = '/Downloads/RFQ/Archive/',
): Promise<ConsentedClient> {
  if (!SESSIONS.has(host)) SESSIONS.set(host, await mint(host, probePath))

  const request = async (
    path: string,
    init: { method?: 'GET' | 'POST'; body?: string; range?: { start: number; end?: number } },
    isRetry = false,
  ): Promise<ConsentedResponse> => {
    const session = SESSIONS.get(host)
    const url = new URL(path, DIBBS_ORIGINS[host]).toString()
    const res = await egressFetch(url, {
      method: init.method ?? 'GET',
      headers: {
        ...(session && session.cookies.size > 0 ? { Cookie: cookieHeader(session) } : {}),
        ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: init.body,
      range: init.range,
    })

    if (/dodwarning\.aspx/i.test(res.finalUrl)) {
      await res.body?.cancel().catch(() => {})
      if (isRetry) {
        throw new ConsentError(
          'still_blocked',
          `${host} returned the consent page again after a refresh. Stopping rather than ` +
            `looping: repeated automated retries against this host risk locking the account.`,
        )
      }
      SESSIONS.set(host, await mint(host, path))
      return request(path, init, true)
    }

    /*
     * THE INTERCEPTION-AT-THE-URL CASE, which the finalUrl test above cannot see.
     *
     * Measured on this estate: the F5 serves the DoD banner (and its 'Request Rejected'
     * block page) AT the data file's own URL, HTTP 200, cookies set, no redirect. So an
     * HTML answer to a request for a data file is inspected before it is handed onward.
     * A data file is never text/html; the directory listing is, which is why the check is
     * scoped to paths that name a file rather than to every request.
     */
    const wantsDataFile = /\.(txt|zip|pdf|xlsx?)$/i.test(new URL(url).pathname)
    if (wantsDataFile && (res.contentType ?? '').toLowerCase().includes('text/html')) {
      const bytes = await readBytes(res)
      const marker = findInterceptionMarker(bytes.toString('latin1', 0, 65_536))
      if (marker === 'Request Rejected') {
        // Rate enforcement. A fresh consent session cannot fix a fingerprint block, and
        // re-minting while blocked adds the exact traffic that deepens it. Fail loudly and
        // let the caller's pacing decide when to try again.
        throw new ConsentError(
          'waf_blocked',
          `the F5 WAF served its 'Request Rejected' page at ${res.finalUrl}. Back off ` +
            `before the next attempt; more requests while blocked extend the block.`,
        )
      }
      if (marker) {
        if (isRetry) {
          throw new ConsentError(
            'still_blocked',
            `${host} served an interception page ('${marker}') at ${res.finalUrl} again ` +
              `after a refresh. Stopping rather than looping against a WAF-fronted host.`,
          )
        }
        SESSIONS.set(host, await mint(host, path))
        return request(path, init, true)
      }
      // HTML-labelled but carrying no interception marker: hand it on with its bytes; the
      // ingest classifier downstream still refuses anything that is not the data's shape.
      return toBuffered(res, bytes)
    }

    return toConsented(res)
  }

  return {
    host,
    get: (path, opts) => request(path, { method: 'GET', range: opts?.range }),
    postForm: (path, form) =>
      request(path, { method: 'POST', body: new URLSearchParams(form).toString() }),
    refresh: async () => {
      SESSIONS.set(host, await mint(host, probePath))
    },
  }
}

/** Drop held sessions. Tests, and the operator's "reconnect" action. */
export function resetConsentSessions(): void {
  SESSIONS.clear()
}
