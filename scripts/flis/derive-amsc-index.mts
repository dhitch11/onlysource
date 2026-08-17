/**
 * DERIVE THE ACQUISITION-CODE INDEX (AMC / AMSC / AAC / PICA) FROM THE FREE FLIS EXTRACT.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS IS THE BLUEPRINT ANSWER
 * ---------------------------------------------------------------------------------------
 * The owner asked for "blueprints". An operator does not need the drawing; they need to know
 * whether the government HOLDS the technical data and MAY release it, and therefore whether
 * anyone other than the incumbent may legally make the part. That is the Acquisition Method
 * Suffix Code, and DoD publishes it free.
 *
 * The obvious alternative was refuted first: `MEDALS` in `V_FLIS_PART.CSV`, the engineering
 * data locator, is populated on 4,332 of 16,576,322 rows (0.0261%), uniformly across all ten
 * deciles of the file. A blueprint indicator blank on 99.94% of the catalogue would render
 * "no engineering data" for nearly every item, where the blank means "not recorded in this
 * field", not "no drawing exists".
 *
 * ---------------------------------------------------------------------------------------
 * ★ THE STRUCTURE THAT DECIDES THE WHOLE DESIGN: AMSC IS BIMODAL BY PICA
 * ---------------------------------------------------------------------------------------
 * Catalogue-wide, AMSC is populated on 47.09% of 18,208,227 MOE rows. That number invites the
 * wrong conclusion, which is that half the data is missing at random. It is not. Measured
 * per PICA (the Primary Inventory Control Activity, i.e. who manages the item):
 *
 *     GX  100.00%   (6,056,962 of 6,056,971)
 *     DH  100.00%   (1,432,299 of 1,432,299)
 *     ZW, ZH, ZU, YB, ZC, YA, ZR, YD ...   0.00%
 *
 * **A blank is not a missing value. It is a different publisher.** So the resolver must
 * establish the PICA first, treat AMSC as authoritative where that PICA publishes it, and
 * ABSTAIN everywhere else. Rendering a blank as "not restricted" would invent permission to
 * bid, which is the expensive direction of this error.
 *
 * The publishing PICAs are therefore MEASURED here and written into the index, never
 * hardcoded: a hardcoded list of publishers is a defect with a delay on it, wrong the first
 * month DLA changes who publishes what.
 *
 * USAGE:  npx tsx scripts/flis/derive-amsc-index.mts
 * INPUT:  ~/onlysource-data/flis/MOE_RULE.zip   (or FLIS_SOURCE_DIR)
 * OUTPUT: <data root>/flis/amsc-index.json
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

import { archivePath, dataPath } from '../../lib/data-root'

/**
 * ★ WHY THIS SCRIPT READS THE ARCHIVE DIRECTLY INSTEAD OF CALLING `buildAllDatasets()`.
 *
 * Two reasons, and the second is the better one.
 *
 * 1. `lib/intelligence/datasets.ts` now pulls `server-only` through its import chain, which
 *    throws outside a React Server Component and kills any plain `tsx` script that touches it.
 * 2. More importantly: the served feed day MOVES. Deriving the wanted set from whatever day
 *    happens to be served would rebuild a different index each time the feed advanced, and an
 *    NSN would fall out of the index simply because it was not solicited this morning. Reading
 *    every captured day gives a set that only grows, which is the correct shape for a catalogue
 *    join. The NSN occupies index-file byte offsets [13,26), an offset VERIFIED in
 *    `lib/ingest/parse/dibbs.ts` against 3,095 real rows; it is not re-derived here.
 */
function niinsFromArchive(): { niins: Set<string>; files: number; rows: number } {
  const root = archivePath('dibbs-rfq-daily')
  const niins = new Set<string>()
  let files = 0
  let rows = 0
  if (!existsSync(root)) return { niins, files, rows }
  for (const day of readdirSync(root)) {
    const dayDir = path.join(root, day)
    for (const capture of readdirSync(dayDir)) {
      const capDir = path.join(dayDir, capture)
      for (const name of readdirSync(capDir)) {
        if (!/^in\d+\.txt$/i.test(name)) continue
        files += 1
        const text = readFileSync(path.join(capDir, name), 'latin1')
        for (const line of text.split('\n')) {
          if (line.length < 26) continue
          const nsn = line.slice(13, 26).trim()
          if (nsn.length === 13 && /^\d+$/.test(nsn)) { niins.add(nsn.slice(4)); rows += 1 }
        }
      }
    }
  }
  return { niins, files, rows }
}

const SOURCE_DIR = process.env.FLIS_SOURCE_DIR ?? path.join(os.homedir(), 'onlysource-data', 'flis')

/** A PICA must publish AMSC on at least this share of its rows to be treated as a publisher. */
const PUBLISHER_THRESHOLD = 0.5
/** and on at least this many rows, so a PICA with three rows cannot become a "publisher". */
const PUBLISHER_MIN_ROWS = 1000

function zipMemberLines(zipPath: string, member: string): AsyncIterable<string> {
  const child = spawn('unzip', ['-p', zipPath, member], { stdio: ['ignore', 'pipe', 'inherit'] })
  return createInterface({ input: child.stdout, crlfDelay: Infinity })
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1 } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { out.push(field); field = '' }
    else field += c
  }
  out.push(field)
  return out
}

async function main(): Promise<void> {
  const moePath = path.join(SOURCE_DIR, 'MOE_RULE.zip')
  if (!existsSync(moePath)) {
    console.error(`MISSING: ${moePath}\nSee memory project_onlysource_flis_publog_acquisition_2026_08_17.`)
    process.exit(1)
  }

  /* ------------------------------------------------------------ 1. the NIINs we care about */
  const scan = niinsFromArchive()
  const wanted = scan.niins
  console.log(`archive: ${scan.files} index files, ${scan.rows} well-formed rows, ${wanted.size} DISTINCT NIINs`)

  /* ------------------------------------------ 2. one pass: per-PICA rates AND our own rows */
  type Row = { niin: string; amc: string; amsc: string; aac: string; pica: string }
  const kept = new Map<string, Row>()
  const picaRows = new Map<string, { rows: number; withAmsc: number }>()
  let total = 0
  let header: string[] | null = null
  let iN = 0, iA = 0, iS = 0, iC = 0, iP = 0
  for await (const line of zipMemberLines(moePath, 'V_MOE_RULE.CSV')) {
    const f = splitCsvLine(line)
    if (!header) {
      header = f.map((x) => x.trim().replace(/^"|"$/g, ''))
      iN = header.indexOf('NIIN'); iA = header.indexOf('AMC'); iS = header.indexOf('AMSC')
      iC = header.indexOf('AAC'); iP = header.indexOf('PICA')
      continue
    }
    total += 1
    if (f.length <= Math.max(iN, iA, iS, iC, iP)) continue
    const pica = (f[iP] ?? '').trim()
    const amsc = (f[iS] ?? '').trim()
    const stat = picaRows.get(pica) ?? { rows: 0, withAmsc: 0 }
    stat.rows += 1
    if (amsc) stat.withAmsc += 1
    picaRows.set(pica, stat)

    const niin = (f[iN] ?? '').trim()
    if (!wanted.has(niin)) continue
    // Prefer a row that actually carries an AMSC: an item can appear under several MOE rules
    // and only the managing activity's row carries the acquisition codes.
    const prior = kept.get(niin)
    if (!prior || (!prior.amsc && amsc)) {
      kept.set(niin, { niin, amc: (f[iA] ?? '').trim(), amsc, aac: (f[iC] ?? '').trim(), pica })
    }
  }

  /* -------------------------------------------------- 3. WHICH PICAs PUBLISH — measured */
  const publishers: Record<string, { rows: number; withAmsc: number; rate: number }> = {}
  const nonPublishers: string[] = []
  for (const [pica, s] of picaRows) {
    const rate = s.rows ? s.withAmsc / s.rows : 0
    if (s.rows >= PUBLISHER_MIN_ROWS && rate >= PUBLISHER_THRESHOLD) {
      publishers[pica] = { rows: s.rows, withAmsc: s.withAmsc, rate }
    } else if (s.rows >= PUBLISHER_MIN_ROWS) {
      nonPublishers.push(pica)
    }
  }
  console.log(`MOE rows scanned: ${total}`)
  console.log(`PICAs that PUBLISH AMSC (>=${PUBLISHER_MIN_ROWS} rows, >=${PUBLISHER_THRESHOLD * 100}%):`)
  for (const [p, s] of Object.entries(publishers).sort((a, b) => b[1].rows - a[1].rows)) {
    console.log(`   ${p.padEnd(4)} ${s.rows.toString().padStart(9)} rows  ${(100 * s.rate).toFixed(2)}%`)
  }
  console.log(`PICAs that do NOT publish (>=${PUBLISHER_MIN_ROWS} rows): ${nonPublishers.length} -> ${nonPublishers.slice(0, 12).join(' ')}`)

  const resolved = [...kept.values()]
  const withAmsc = resolved.filter((r) => r.amsc).length
  const fromPublisher = resolved.filter((r) => publishers[r.pica]).length
  console.log(`\nour NIINs found in MOE: ${resolved.length} of ${wanted.size}`)
  console.log(`   carrying an AMSC:            ${withAmsc}`)
  console.log(`   managed by a publishing PICA: ${fromPublisher}`)

  /* --------------------------------------------------------------------------- 4. write */
  const outDir = dataPath('flis')
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'amsc-index.json')
  const payload = {
    provenance: {
      derivedFrom: [{ file: 'MOE_RULE.zip::V_MOE_RULE.CSV', rows: total }],
      sourceDir: SOURCE_DIR,
      archiveIndexFiles: scan.files,
      archiveWellFormedRows: scan.rows,
      referencedNiins: wanted.size,
      resolvedNiins: resolved.length,
      niinsWithAmsc: withAmsc,
      niinsManagedByPublishingPica: fromPublisher,
      publisherThreshold: PUBLISHER_THRESHOLD,
      publisherMinRows: PUBLISHER_MIN_ROWS,
    },
    /** MEASURED, never hardcoded. The resolver abstains for any PICA absent from this map. */
    publishers,
    rows: resolved,
  }
  writeFileSync(outPath, JSON.stringify(payload))
  console.log(`\nwrote ${outPath} (${(JSON.stringify(payload).length / 1e6).toFixed(2)} MB)`)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
