/**
 * DISTRESSED SUPPLIER INTELLIGENCE — the enriched "book of business".
 *
 * The award-silence list in datasets.ts is four bare columns. THIS is the enriched version: 3,472
 * companies that have stopped winning DLA awards, each scored and researched — prospect tier, a
 * rationale, SAM registration status, a "does this CAGE hold inventory" read, the executive and
 * verified contact channels — joined to 10,168 individually verified contacts. It is the raw
 * material for the play Wayne describes: a manufacturer or distributor that has gone quiet is
 * sitting on inventory it sold DLA, and that inventory is the opportunity.
 *
 * Everything here is a measurement read from the researched files. A blank field is rendered as
 * absent, never invented. The prospect score is the researcher's, carried through unchanged and
 * labeled as such, never recomputed or dressed up as ours.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dataPath } from '@/lib/data-root'

const MASTER = 'suppliers/distressed-master.csv'
const CONTACTS = 'suppliers/distressed-contacts.csv'

export type SupplierContact = {
  name: string | null
  title: string | null
  email: string | null
  emailType: string | null
  verified: boolean
  linkedin: string | null
  phone: string | null
}

export type DistressedSupplier = {
  cage: string
  company: string | null
  city: string | null
  state: string | null
  url: string | null
  phone: string | null
  email: string | null
  executive: string | null
  executiveTitle: string | null
  executiveLinkedin: string | null
  currentlyInBusiness: string | null
  awardsInWindow: number | null
  lastAwardedAt: string | null
  whyNoAwards: string | null
  prospectTier: string | null
  prospectScore: number | null
  prospectRationale: string | null
  keyFindings: string | null
  uei: string | null
  cageStatus: string | null
  /** The researched read of whether this CAGE actually holds sellable inventory. */
  holdsInventory: string | null
  samExpiration: string | null
  samStatus: string | null
  employees: string | null
  industry: string | null
  companyLinkedin: string | null
  contacts: SupplierContact[]
}

export type DistressedSuppliersIndex = {
  ok: true
  suppliers: DistressedSupplier[]
  byCage: Map<string, DistressedSupplier>
  counts: { suppliers: number; contacts: number; verifiedContacts: number; withEmail: number; tierA: number }
  provenance: { path: string; sha256: string; rows: number }[]
}
export type DistressedSuppliersUnavailable = { ok: false; reason: string }

let cache: DistressedSuppliersIndex | DistressedSuppliersUnavailable | null = null

/** RFC 4180 CSV parse: honors quoted fields, embedded commas/newlines, and "" escapes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text // strip BOM
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1 } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* ignore, handled by \n */ }
    else field += c
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

function toRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text)
  if (rows.length === 0) return []
  const headers = (rows[0] as string[]).map((h) => h.trim())
  const out: Record<string, string>[] = []
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i] as string[]
    if (r.length === 1 && r[0] === '') continue
    const rec: Record<string, string> = {}
    headers.forEach((h, j) => { rec[h] = (r[j] ?? '').trim() })
    out.push(rec)
  }
  return out
}

const s = (v: string | undefined): string | null => (v && v !== '' ? v : null)
const n = (v: string | undefined): number | null => {
  if (!v) return null
  const x = Number(v.replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(x) ? x : null
}

export function buildDistressedSuppliers(): DistressedSuppliersIndex | DistressedSuppliersUnavailable {
  if (cache) return cache
  const masterPath = dataPath(MASTER)
  const contactsPath = dataPath(CONTACTS)
  if (!existsSync(masterPath)) {
    cache = { ok: false, reason: 'The enriched distressed-supplier file is not on disk.' }
    return cache
  }

  const masterBuf = readFileSync(masterPath)
  const master = toRecords(masterBuf.toString('utf8'))
  const provenance = [{ path: masterPath, sha256: createHash('sha256').update(masterBuf).digest('hex'), rows: master.length }]

  const byCage = new Map<string, DistressedSupplier>()
  for (const r of master) {
    const cage = s(r['cage'])?.toUpperCase()
    if (!cage) continue
    byCage.set(cage, {
      cage,
      company: s(r['company']) ?? s(r['Legal Business Name (CAGE)']),
      city: s(r['city']),
      state: s(r['state']),
      url: s(r['URL']),
      phone: s(r['Phone']),
      email: s(r['Email']),
      executive: s(r['Executive Name']) ?? s(r['Executive']),
      executiveTitle: s(r['Executive Title']),
      executiveLinkedin: s(r['Executive LinkedIn']),
      currentlyInBusiness: s(r['Currently in Business']),
      awardsInWindow: n(r['awards_in_window']),
      lastAwardedAt: s(r['last_awarded_at']),
      whyNoAwards: s(r['Why No Awards']),
      prospectTier: s(r['Prospect Tier']),
      prospectScore: n(r['Prospect Score']),
      prospectRationale: s(r['Prospect Rationale']),
      keyFindings: s(r['Key Findings / Signals']),
      uei: s(r['UEI']),
      cageStatus: s(r['CAGE Status']),
      holdsInventory: s(r['CAGE Type (holds inventory?)']),
      samExpiration: s(r['SAM Expiration']),
      samStatus: s(r['SAM Status']),
      employees: s(r['Employees']),
      industry: s(r['Industry']),
      companyLinkedin: s(r['Company LinkedIn']),
      contacts: [],
    })
  }

  let contactCount = 0
  let verifiedCount = 0
  if (existsSync(contactsPath)) {
    const cbuf = readFileSync(contactsPath)
    const contacts = toRecords(cbuf.toString('utf8'))
    provenance.push({ path: contactsPath, sha256: createHash('sha256').update(cbuf).digest('hex'), rows: contacts.length })
    for (const r of contacts) {
      const cage = s(r['cage'])?.toUpperCase()
      if (!cage) continue
      const sup = byCage.get(cage)
      const verified = /^y|true|verified/i.test(r['Verified'] ?? '')
      const c: SupplierContact = {
        name: s(r['Contact Name']),
        title: s(r['Title']),
        email: s(r['Email']),
        emailType: s(r['Email Type']),
        verified,
        linkedin: s(r['LinkedIn']),
        phone: s(r['Company Phone']),
      }
      contactCount += 1
      if (verified) verifiedCount += 1
      if (sup && sup.contacts.length < 25) sup.contacts.push(c)
    }
  }

  const suppliers = [...byCage.values()].sort((a, b) => (b.prospectScore ?? -1) - (a.prospectScore ?? -1))
  cache = {
    ok: true,
    suppliers,
    byCage,
    counts: {
      suppliers: suppliers.length,
      contacts: contactCount,
      verifiedContacts: verifiedCount,
      withEmail: suppliers.filter((x) => x.email || x.contacts.some((c) => c.email)).length,
      tierA: suppliers.filter((x) => /^a|tier\s*1|1/i.test(x.prospectTier ?? '')).length,
    },
    provenance,
  }
  return cache
}

export function resetDistressedSuppliersCache(): void {
  cache = null
}
