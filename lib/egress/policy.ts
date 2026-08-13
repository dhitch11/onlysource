import 'server-only'

/**
 * PER-HOST OUTBOUND HEADER POLICY, and the egress identity each host is reached from.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * TWO DIFFERENT THINGS ARE CALLED "HEADER STRIPPING" AND CONFLATING THEM CAUSES A LIVE 403.
 *
 *   OUTBOUND policy (this file): which headers we SEND. Some government hosts refuse a request
 *   that does not look like a browser.
 *
 *   LOG redaction (`LOG_REDACTED_HEADERS` below, and `lib/log.ts`): which headers we never
 *   RECORD. Authorization and Cookie must never reach a log sink.
 *
 * An earlier draft of this lane's claim described the egress client as doing "header stripping"
 * without that distinction, and @T2 correctly read it as a global outbound strip and filed it as
 * a day-one 403. They were right to. The two concerns are now named separately and neither can
 * be mistaken for the other.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * THE MEASURED FACT THAT FORCES THIS (T2, verified): `www.dla.mil` is Akamai-fronted and
 * returned HTTP 403 "Access Denied" to every plain request, succeeding ONLY with a full browser
 * header set. That host serves the reading-room CSV extracts, which are the entire monthly
 * federal catalog (16.5M part rows, 18.2M MOE rule rows, 40M+ characteristic rows). A blanket
 * strip means the catalog load 403s on its first run and the failure looks like a network
 * problem rather than a header problem, which is the expensive kind of wrong.
 */

/**
 * Which reserved egress IP a call leaves by.
 *
 * NOT COSMETIC. The box has two static egress IPs and they must never be shared: the
 * credentialed identity is the one registered with SAM for the 1,000-request/day roled tier,
 * and if credentialed action and anonymous public-file fetching leave by the same address, the
 * DIBBS WAF reads one IP wearing two identities as an attack and locks the account. That is a
 * business outage, not a warning.
 */
export type EgressIdentity = 'public_file' | 'credentialed'

export type HostPolicy = {
  /** Exact hostname match. No wildcards: a wildcard is how an unintended host inherits a policy. */
  host: string
  identity: EgressIdentity
  /** Headers to SEND. Empty means send only what the client adds by default. */
  outboundHeaders: Record<string, string>
  /** Whether this host honors HTTP Range. Asymmetric across our sources; see below. */
  honorsRange: boolean
  /** Why this policy exists, in words, so nobody deletes it as boilerplate. */
  rationale: string
}

/**
 * The full browser header set `www.dla.mil` requires.
 *
 * Every header here was measured as necessary. This is not a "look more like a browser" grab
 * bag: it is the set that turned a 403 into a 200. Do not trim it because it looks verbose.
 */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'sec-ch-ua': '"Chromium";v="125", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Linux"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
}

/**
 * The seed table. @T2 owns the per-source policy content and will amend it; T7 owns the
 * mechanism and where it is enforced. Rows are added by measurement, never by assumption.
 */
export const HOST_POLICIES: readonly HostPolicy[] = [
  {
    host: 'www.dla.mil',
    identity: 'public_file',
    outboundHeaders: BROWSER_HEADERS,
    // Measured: refuses Range outright, unlike the blob storage below. Same pipeline, two
    // strategies, and both are mandatory.
    honorsRange: false,
    rationale:
      'Akamai-fronted. Returns 403 Access Denied to a plain request; only a full browser ' +
      'header set succeeds. Serves the monthly federal catalog extracts.',
  },
  {
    host: 'dibbs.bsm.dla.mil',
    identity: 'public_file',
    outboundHeaders: BROWSER_HEADERS,
    honorsRange: false,
    rationale:
      'Behind an F5 ASM that fingerprints requests. GET /robots.txt returns a block page, so ' +
      'there is no robots.txt to honor. Consent state is per host and is minted by the vault.',
  },
  {
    host: 'dibbs2.bsm.dla.mil',
    identity: 'public_file',
    outboundHeaders: BROWSER_HEADERS,
    honorsRange: false,
    rationale:
      'The SECOND DIBBS host, and it holds consent state SEPARATELY from dibbs.bsm.dla.mil. ' +
      'Two hosts, two consent sessions; treating them as one is how an ingest 302s into a banner.',
  },
  {
    host: 'api.sam.gov',
    identity: 'credentialed',
    outboundHeaders: {},
    honorsRange: false,
    rationale:
      'Credentialed. MUST leave by the registered static egress IP or the roled 1,000/day tier ' +
      'does not apply. An invalid key returns 404 with an empty body, not 401.',
  },
]

/** Headers that must never be RECORDED, regardless of whether they were sent. */
export const LOG_REDACTED_HEADERS: readonly string[] = [
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
]

/**
 * Resolve the policy for a URL.
 *
 * The default for an unknown host is `public_file` with NO added headers. That is the
 * conservative direction: an unknown host never inherits the credentialed egress identity by
 * accident, because inheriting it would put anonymous traffic on the SAM-registered IP.
 */
export function policyFor(url: URL): HostPolicy {
  const found = HOST_POLICIES.find((p) => p.host === url.hostname)
  if (found) return found
  return {
    host: url.hostname,
    identity: 'public_file',
    outboundHeaders: {},
    honorsRange: false,
    rationale: 'No specific policy recorded for this host. Defaults to the uncredentialed identity.',
  }
}

/** Apply the outbound policy to a header set the caller supplied. Caller wins on conflict. */
export function applyOutboundPolicy(
  policy: HostPolicy,
  callerHeaders: Record<string, string> = {},
): Record<string, string> {
  return { ...policy.outboundHeaders, ...callerHeaders }
}

/** Redact a header set for logging. Allow-list-adjacent: named headers are replaced, never dropped. */
export function redactHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = LOG_REDACTED_HEADERS.includes(k.toLowerCase()) ? '[redacted]' : v
  }
  return out
}
