import 'server-only'
import { lookup } from 'node:dns/promises'
import { applyOutboundPolicy, policyFor, redactHeadersForLog, type EgressIdentity } from './policy'
import { classifyAddress } from './ssrf'

/**
 * THE ONE EGRESS-CONTROLLED HTTP CLIENT. Bare `fetch` is linted out of this repo.
 *
 * Every customer- or config-supplied URL in this lane (webhook endpoints, connector base URLs,
 * health probes, the DIBBS consent handshake) goes through here. The reason is in the charter:
 * a supplied URL is a request generator pointed wherever the supplier likes, fired from inside
 * our network by a process holding government credentials.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * THE REDIRECT RULE IS THE ONE PEOPLE GET WRONG.
 *
 * Checking the first URL and then handing the request to a redirect-following client checks
 * nothing: the first hop can be a public host that 302s to 169.254.169.254. So redirects are
 * NEVER followed automatically (`redirect: 'manual'`). Each hop is re-resolved and
 * re-classified before it is taken, and the caller sees the final URL it actually reached.
 * That last part is not a nicety; @T2 needs it because both DIBBS hosts 302 every path to
 * /dodwarning.aspx when consent has lapsed, and without the final URL an expired session is
 * indistinguishable from a real page.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * WHAT THIS DOES NOT DO YET, STATED RATHER THAN IMPLIED: it does not bind the socket to a
 * specific source IP. The box has two reserved egress identities and the policy layer already
 * decides WHICH one a call belongs to, but binding it requires the server. The identity travels
 * with the request and is logged, so nothing silently leaves by the wrong one; the enforcement
 * lands with the box.
 */

export type EgressResponse = {
  status: number
  headers: Headers
  /** The URL actually reached, after every hop. Never the URL requested. */
  finalUrl: string
  contentType: string | null
  /** Streamed, never buffered: one archive in this pipeline is 1.73 GB. */
  body: ReadableStream<Uint8Array> | null
  /** Which reserved egress identity this call belongs to. */
  identity: EgressIdentity
}

export class EgressBlockedError extends Error {
  readonly code = 'egress_blocked'
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`Egress refused for ${url}: ${reason}`)
    this.name = 'EgressBlockedError'
  }
}

export type EgressRequest = {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** Byte range. Only sent to hosts whose policy records that they honor it. */
  range?: { start: number; end?: number }
  /** Hard ceiling on redirect hops. Each one is re-resolved and re-classified. */
  maxRedirects?: number
  signal?: AbortSignal
}

/** Resolve a hostname and refuse if ANY resolved address is one we must not reach. */
async function assertHostAllowed(url: URL): Promise<void> {
  // A literal IP in the URL is classified directly; there is nothing to resolve.
  const direct = classifyAddress(url.hostname)
  if (direct.allowed) return
  if (direct.reason !== 'not_an_ip') {
    throw new EgressBlockedError(url.toString(), `${direct.reason} (${direct.detail})`)
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(url.hostname, { all: true })
  } catch {
    throw new EgressBlockedError(url.toString(), 'hostname did not resolve')
  }
  if (addresses.length === 0) {
    throw new EgressBlockedError(url.toString(), 'hostname resolved to no addresses')
  }
  // EVERY address must pass. A host with one public and one loopback A record is a rebinding
  // attempt, and taking the first passing answer is how it succeeds.
  for (const a of addresses) {
    const verdict = classifyAddress(a.address)
    if (!verdict.allowed) {
      throw new EgressBlockedError(
        url.toString(),
        `resolves to a forbidden address: ${verdict.reason} (${verdict.detail})`,
      )
    }
  }
}

/**
 * Perform an egress-controlled request.
 *
 * Returns the response with its body still unread, so a 1.7 GB archive streams rather than
 * buffering, and so a health probe cannot accidentally consume the body a caller needs.
 */
export async function egressFetch(
  rawUrl: string,
  req: EgressRequest = {},
): Promise<EgressResponse> {
  const maxRedirects = req.maxRedirects ?? 5
  let url = new URL(rawUrl)
  let hops = 0

  for (;;) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new EgressBlockedError(url.toString(), `refused protocol ${url.protocol}`)
    }
    await assertHostAllowed(url)

    const policy = policyFor(url)
    const headers = applyOutboundPolicy(policy, req.headers)
    if (req.range) {
      if (!policy.honorsRange) {
        // Sending Range to a host that refuses it produces a confusing full-body response or a
        // 400. Refusing here names the real cause instead.
        throw new EgressBlockedError(
          url.toString(),
          `a byte range was requested but ${policy.host} is recorded as not honoring Range`,
        )
      }
      headers.Range = `bytes=${req.range.start}-${req.range.end ?? ''}`
    }

    const res = await fetch(url, {
      method: req.method ?? 'GET',
      headers,
      body: req.body,
      redirect: 'manual',
      signal: req.signal,
    })

    const location = res.headers.get('location')
    const isRedirect = res.status >= 300 && res.status < 400 && location
    if (!isRedirect) {
      return {
        status: res.status,
        headers: res.headers,
        finalUrl: url.toString(),
        contentType: res.headers.get('content-type'),
        body: res.body,
        identity: policy.identity,
      }
    }

    if (hops >= maxRedirects) {
      throw new EgressBlockedError(url.toString(), `exceeded ${maxRedirects} redirects`)
    }
    hops += 1
    // Cancel the redirect body so the socket is not left hanging.
    await res.body?.cancel().catch(() => {})
    // The next hop is re-resolved and re-classified at the top of the loop. That is the point.
    url = new URL(location, url)
  }
}

/** Header set safe to attach to a log line. Exported so callers cannot forget to redact. */
export function loggableHeaders(headers: Record<string, string>): Record<string, string> {
  return redactHeadersForLog(headers)
}
