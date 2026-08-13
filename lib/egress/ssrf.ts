import 'server-only'
import { isIP } from 'node:net'

/**
 * SSRF address classification.
 *
 * WHY THIS EXISTS: a customer-supplied webhook URL, a connector `base_url` and a health-probe
 * target are all request generators pointed wherever the supplier likes, fired from inside our
 * network by a process that holds government credentials and sits on a box with two reserved
 * egress IPs. "Fetch this URL" is the most dangerous primitive in this lane.
 *
 * The classification below is deliberately a DENY-BY-RANGE list rather than an allow-list of
 * public addresses, because the set of harmful destinations is enumerable and stable (RFC 1918,
 * loopback, link-local, CGNAT, the cloud metadata address) while the set of legitimate public
 * hosts is not.
 *
 * THE ONE THAT ACTUALLY GETS PEOPLE: 169.254.169.254, the cloud metadata endpoint. It is a
 * perfectly ordinary-looking IPv4 address that returns instance credentials to anything on the
 * box that asks. It is inside link-local, so the range check already covers it, and it is called
 * out by name here so nobody "optimises" link-local away without understanding what they are
 * removing.
 *
 * IPv6 is handled rather than ignored: `::1`, `fc00::/7` (unique local), `fe80::/10`
 * (link-local) and, critically, IPv4-mapped forms like `::ffff:127.0.0.1`, which is the classic
 * bypass of a naive IPv4-only checker.
 */

export type AddressVerdict =
  | { allowed: true }
  | { allowed: false; reason: BlockReason; detail: string }

export type BlockReason =
  | 'loopback'
  | 'private'
  | 'link_local'
  | 'cloud_metadata'
  | 'unspecified'
  | 'multicast'
  | 'reserved'
  | 'not_an_ip'

/**
 * Classify a resolved IP literal.
 *
 * Takes an ADDRESS, never a hostname, and that signature is the point: a checker that accepts a
 * hostname invites the caller to check one thing and connect to another. DNS rebinding lives in
 * exactly that gap. The caller resolves, checks every resolved address, and then connects to the
 * address it checked.
 */
export function classifyAddress(address: string): AddressVerdict {
  const family = isIP(address)
  if (family === 0) {
    return { allowed: false, reason: 'not_an_ip', detail: 'not a valid IP literal' }
  }
  return family === 4 ? classifyV4(address) : classifyV6(address)
}

function classifyV4(address: string): AddressVerdict {
  const parts = address.split('.').map((p) => Number.parseInt(p, 10))
  const [a, b] = parts as [number, number, number, number]

  if (a === 127) return block('loopback', '127.0.0.0/8')
  if (a === 0) return block('unspecified', '0.0.0.0/8')
  if (a === 10) return block('private', '10.0.0.0/8')
  if (a === 172 && b >= 16 && b <= 31) return block('private', '172.16.0.0/12')
  if (a === 192 && b === 168) return block('private', '192.168.0.0/16')
  // CGNAT. Routable-looking, not public, and a real path to a neighbour's box.
  if (a === 100 && b >= 64 && b <= 127) return block('private', '100.64.0.0/10')
  if (a === 169 && b === 254) {
    // The metadata endpoint lives here. Named explicitly so its removal is a deliberate act.
    return address === '169.254.169.254'
      ? block('cloud_metadata', '169.254.169.254, the instance metadata endpoint')
      : block('link_local', '169.254.0.0/16')
  }
  if (a === 192 && b === 0) return block('reserved', '192.0.0.0/24 and 192.0.2.0/24')
  if (a >= 224 && a <= 239) return block('multicast', '224.0.0.0/4')
  if (a >= 240) return block('reserved', '240.0.0.0/4')
  return { allowed: true }
}

function classifyV6(address: string): AddressVerdict {
  const lower = address.toLowerCase()

  // IPv4-mapped and IPv4-compatible forms. `::ffff:127.0.0.1` is loopback wearing a v6 coat,
  // and an IPv4-only checker waves it straight through.
  const mapped = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped?.[1]) return classifyV4(mapped[1])

  if (lower === '::1') return block('loopback', '::1')
  if (lower === '::') return block('unspecified', '::')
  const head = lower.split(':')[0] ?? ''
  const first = Number.parseInt(head.padStart(4, '0').slice(0, 4), 16)
  if (Number.isNaN(first)) return block('not_an_ip', 'unparseable IPv6 prefix')
  // fc00::/7, unique local.
  if ((first & 0xfe00) === 0xfc00) return block('private', 'fc00::/7')
  // fe80::/10, link-local.
  if ((first & 0xffc0) === 0xfe80) return block('link_local', 'fe80::/10')
  // ff00::/8, multicast.
  if ((first & 0xff00) === 0xff00) return block('multicast', 'ff00::/8')
  return { allowed: true }
}

function block(reason: BlockReason, detail: string): AddressVerdict {
  return { allowed: false, reason, detail }
}
