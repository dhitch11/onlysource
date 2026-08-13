import { describe, expect, it } from 'vitest'
import { classifyAddress } from '@/lib/egress/ssrf'
import {
  applyOutboundPolicy,
  policyFor,
  redactHeadersForLog,
} from '@/lib/egress/policy'

/**
 * SSRF classification and the per-host outbound policy.
 *
 * Every block assertion is paired with a positive control on a real public address, because a
 * classifier that returned `allowed: false` unconditionally would pass every block test and be
 * completely useless. The controls are what make the refusals mean something.
 */

describe('SSRF: addresses that must be refused', () => {
  it('ALLOWS ordinary public addresses (POSITIVE CONTROL)', () => {
    for (const addr of ['8.8.8.8', '1.1.1.1', '104.16.0.1', '2606:4700::1111']) {
      expect(classifyAddress(addr), addr).toEqual({ allowed: true })
    }
  })

  it('refuses loopback, private, CGNAT and link-local v4', () => {
    const cases: Array<[string, string]> = [
      ['127.0.0.1', 'loopback'],
      ['10.1.2.3', 'private'],
      ['172.16.0.1', 'private'],
      ['172.31.255.255', 'private'],
      ['192.168.1.1', 'private'],
      ['100.64.0.1', 'private'],
      ['169.254.1.1', 'link_local'],
      ['0.0.0.0', 'unspecified'],
      ['224.0.0.1', 'multicast'],
    ]
    for (const [addr, reason] of cases) {
      const v = classifyAddress(addr)
      expect(v.allowed, addr).toBe(false)
      if (!v.allowed) expect(v.reason, addr).toBe(reason)
    }
  })

  it('refuses the cloud metadata endpoint BY NAME, not merely as link-local', () => {
    // 169.254.169.254 returns instance credentials to anything on the box that asks. It is
    // classified distinctly so that removing link-local handling cannot silently un-block it.
    const v = classifyAddress('169.254.169.254')
    expect(v.allowed).toBe(false)
    if (!v.allowed) expect(v.reason).toBe('cloud_metadata')
  })

  it('refuses 172.15 and 172.32 correctly, which are OUTSIDE the private range', () => {
    // The /12 boundary is the classic off-by-one in hand-written checkers. These two are public
    // and must be allowed; getting this wrong in the blocking direction breaks real fetches.
    expect(classifyAddress('172.15.0.1')).toEqual({ allowed: true })
    expect(classifyAddress('172.32.0.1')).toEqual({ allowed: true })
  })

  it('refuses IPv6 loopback, unique-local and link-local', () => {
    expect(classifyAddress('::1').allowed).toBe(false)
    expect(classifyAddress('fc00::1').allowed).toBe(false)
    expect(classifyAddress('fd12:3456::1').allowed).toBe(false)
    expect(classifyAddress('fe80::1').allowed).toBe(false)
  })

  it('refuses IPv4-mapped IPv6 forms, the classic bypass', () => {
    // An IPv4-only checker waves `::ffff:127.0.0.1` straight through to loopback.
    const mapped = classifyAddress('::ffff:127.0.0.1')
    expect(mapped.allowed).toBe(false)
    if (!mapped.allowed) expect(mapped.reason).toBe('loopback')

    const mappedMeta = classifyAddress('::ffff:169.254.169.254')
    expect(mappedMeta.allowed).toBe(false)
    if (!mappedMeta.allowed) expect(mappedMeta.reason).toBe('cloud_metadata')
  })

  it('refuses a hostname, because this function takes a resolved address only', () => {
    // Accepting a hostname would invite checking one thing and connecting to another, which is
    // the gap DNS rebinding lives in.
    const v = classifyAddress('example.com')
    expect(v.allowed).toBe(false)
    if (!v.allowed) expect(v.reason).toBe('not_an_ip')
  })
})

describe('per-host outbound policy: the day-one 403 @T2 filed', () => {
  it('sends the FULL browser header set to www.dla.mil', () => {
    // Measured: this host is Akamai-fronted and 403s a plain request. A blanket outbound strip
    // breaks the entire monthly catalog load, and the failure looks like a network problem.
    const p = policyFor(new URL('https://www.dla.mil/some/extract.csv'))
    const sent = applyOutboundPolicy(p)
    for (const h of [
      'User-Agent',
      'Accept',
      'Accept-Language',
      'Accept-Encoding',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
      'Sec-Fetch-Dest',
      'Sec-Fetch-Mode',
      'Sec-Fetch-Site',
      'Sec-Fetch-User',
      'Upgrade-Insecure-Requests',
    ]) {
      expect(Object.keys(sent), `missing ${h}`).toContain(h)
    }
  })

  it('treats the two DIBBS hosts as SEPARATE policy entries', () => {
    // They hold consent state separately. Treating them as one host is how an ingest 302s into
    // a consent banner and reads it as data.
    expect(policyFor(new URL('https://dibbs.bsm.dla.mil/x')).host).toBe('dibbs.bsm.dla.mil')
    expect(policyFor(new URL('https://dibbs2.bsm.dla.mil/x')).host).toBe('dibbs2.bsm.dla.mil')
  })

  it('routes SAM by the CREDENTIALED identity and everything unknown by the public one', () => {
    // The credentialed IP is the one registered with SAM. An unknown host must never inherit
    // it, or anonymous traffic ends up on the registered address.
    expect(policyFor(new URL('https://api.sam.gov/x')).identity).toBe('credentialed')
    expect(policyFor(new URL('https://unknown.example.com/x')).identity).toBe('public_file')
    expect(applyOutboundPolicy(policyFor(new URL('https://unknown.example.com/x')))).toEqual({})
  })

  it('lets the caller override a policy header without mutating the policy', () => {
    const p = policyFor(new URL('https://www.dla.mil/x'))
    const sent = applyOutboundPolicy(p, { Accept: 'text/csv' })
    expect(sent.Accept).toBe('text/csv')
    // The shared policy object must not have been edited in place.
    expect(policyFor(new URL('https://www.dla.mil/x')).outboundHeaders.Accept).not.toBe('text/csv')
  })
})

describe('log redaction is a DIFFERENT concern from outbound headers', () => {
  it('redacts credential headers from a log record while leaving them sendable', () => {
    const sent = { Authorization: 'Bearer super-secret-value', 'User-Agent': 'x' }
    const logged = redactHeadersForLog(sent)
    expect(logged.Authorization).toBe('[redacted]')
    expect(logged['User-Agent']).toBe('x')
    // The point of the distinction: the value is still present in what we SEND.
    expect(sent.Authorization).toContain('super-secret-value')
    expect(JSON.stringify(logged)).not.toContain('super-secret-value')
  })

  it('redacts case-insensitively, because header casing is not guaranteed', () => {
    expect(redactHeadersForLog({ COOKIE: 'a=b' }).COOKIE).toBe('[redacted]')
    expect(redactHeadersForLog({ 'set-cookie': 'a=b' })['set-cookie']).toBe('[redacted]')
  })
})
