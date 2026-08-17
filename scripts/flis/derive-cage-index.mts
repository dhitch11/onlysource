/**
 * DERIVE THE COMPACT CAGE INDEX FROM THE FREE FLIS EXTRACT.
 *
 * ---------------------------------------------------------------------------------------
 * WHY DERIVE RATHER THAN SHIP THE SOURCE
 * ---------------------------------------------------------------------------------------
 * `P_CAGE.CSV` is 422 MB and `V_CAGE_ADDRESS.CSV` is 700 MB. The product references 2,916
 * distinct CAGE codes. Shipping a gigabyte to answer three thousand lookups, and paying to
 * hold it in memory on a 2 GB droplet, would be a straightforward waste.
 *
 * So this script derives a compact index for the CAGEs the product actually references, plus
 * every CAGE that shares a corporate complex with one of them, and records provenance for
 * both source files. It follows the pattern `data/archive/derived/` already established:
 * the original stays outside the repo, the derivation is reproducible, and the derived file
 * names the inputs it came from.
 *
 * ---------------------------------------------------------------------------------------
 * THE CONSEQUENCE TO DESIGN AROUND, AND IT IS NOT HYPOTHETICAL
 * ---------------------------------------------------------------------------------------
 * A derived subset is FROZEN AT DERIVATION TIME. The feed brings new CAGEs every day, and a
 * CAGE the index has never seen must resolve to an honest abstention, never to "no such
 * company" and never to a silent blank. `lib/intelligence/manufacturers/cage.ts` carries that
 * rule and a test pins it. Re-run this script when the feed moves or when PUB LOG republishes,
 * which it does on the first business day of each month.
 *
 * USAGE:  npx tsx scripts/flis/derive-cage-index.mts
 * INPUT:  ~/onlysource-data/flis/CAGE.zip, H-SERIES.zip   (or FLIS_SOURCE_DIR)
 * OUTPUT: <data root>/flis/cage-index.json
 */
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

import { buildAllDatasets } from '../../lib/intelligence/datasets'
import { buildNsnAwardIndex } from '../../lib/intelligence/awards/nsn-now'
import { dataPath } from '../../lib/data-root'

const SOURCE_DIR = process.env.FLIS_SOURCE_DIR ?? path.join(os.homedir(), 'onlysource-data', 'flis')

/** Stream a member out of a zip without extracting it to disk. */
function zipMemberLines(zipPath: string, member: string): AsyncIterable<string> {
  const child = spawn('unzip', ['-p', zipPath, member], { stdio: ['ignore', 'pipe', 'inherit'] })
  return createInterface({ input: child.stdout, crlfDelay: Infinity })
}

/**
 * Split one CSV line. The FLIS extract quotes every field and carries no embedded newlines in
 * these two tables (verified: records == physical lines on both), so a line-wise split is safe
 * here and avoids holding a 422 MB string in memory.
 */
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
  const cagePath = path.join(SOURCE_DIR, 'CAGE.zip')
  const hPath = path.join(SOURCE_DIR, 'H-SERIES.zip')
  for (const p of [cagePath, hPath]) {
    if (!existsSync(p)) {
      console.error(`MISSING: ${p}\nPull it first (see memory project_onlysource_flis_publog_acquisition_2026_08_17).`)
      process.exit(1)
    }
  }

  /* ---------------------------------------------------------------- 1. who do we need? */
  const wanted = new Set<string>()
  const datasets = buildAllDatasets()
  for (const row of datasets.cornerMap.rows) {
    for (const cage of row.approvedSources) wanted.add(String(cage).toUpperCase())
  }
  const awards = buildNsnAwardIndex()
  if (awards.ok) {
    for (const [, summary] of awards.byNsn) {
      for (const award of (summary as { awards?: Array<{ cage?: string | null }> }).awards ?? []) {
        if (award.cage) wanted.add(String(award.cage).toUpperCase())
      }
    }
  }
  console.log(`referenced CAGEs: ${wanted.size}`)

  /* ------------------------------------------- 2. the corporate complex, whole (6 MB) */
  // Read H5 FIRST, so a referenced CAGE's siblings are pulled into the P_CAGE pass below and
  // the complex can be shown with every member named rather than as a count.
  type Assoc = { association: string; affiliation: string }
  const assoc = new Map<string, Assoc>()
  const complexMembers = new Map<string, string[]>()
  let h5Rows = 0
  let parentCagePopulated = 0
  {
    let header: string[] | null = null
    for await (const line of zipMemberLines(hPath, 'V_H5_CORPORATE.CSV')) {
      const f = splitCsvLine(line)
      if (!header) { header = f.map((x) => x.trim()); continue }
      h5Rows += 1
      const cage = (f[0] ?? '').trim().toUpperCase()
      const parent = (f[1] ?? '').trim()
      const association = (f[5] ?? '').trim().toUpperCase()
      const affiliation = (f[6] ?? '').trim().toUpperCase()
      if (parent) parentCagePopulated += 1
      if (!cage || !association) continue
      assoc.set(cage, { association, affiliation })
      const members = complexMembers.get(association) ?? []
      members.push(cage)
      complexMembers.set(association, members)
    }
  }
  // MEASURED 2026-08-17: 0 of 119,076. Asserted here so the day it changes we find out from a
  // number rather than from a feature that quietly resolves nothing.
  console.log(`H5 rows: ${h5Rows}, PARENT_CAGE populated on: ${parentCagePopulated}`)

  // Pull in every sibling of a referenced CAGE, so a complex renders complete.
  const siblings = new Set<string>()
  for (const cage of wanted) {
    const a = assoc.get(cage)
    if (!a) continue
    for (const m of complexMembers.get(a.association) ?? []) siblings.add(m)
    siblings.add(a.association)
  }
  const target = new Set([...wanted, ...siblings])
  console.log(`+ ${target.size - wanted.size} corporate-complex siblings -> ${target.size} to resolve`)

  /* ------------------------------------------------------- 3. names, from the CAGE master */
  type Company = {
    cage: string
    company: string
    city: string
    state: string
    zip: string
    country: string
    status: string
    type: string
    /** Contract administration office. The exact-match corroborator for a name-prefix merge. */
    cao: string
  }
  const companies = new Map<string, Company>()
  let pCageRows = 0
  {
    let header: string[] | null = null
    for await (const line of zipMemberLines(cagePath, 'P_CAGE.CSV')) {
      const f = splitCsvLine(line)
      if (!header) { header = f.map((x) => x.trim()); continue }
      pCageRows += 1
      const cage = (f[0] ?? '').trim().toUpperCase()
      if (!target.has(cage)) continue
      companies.set(cage, {
        cage,
        status: (f[1] ?? '').trim(),
        type: (f[2] ?? '').trim(),
        cao: (f[3] ?? '').trim(),
        company: (f[4] ?? '').trim(),
        city: (f[5] ?? '').trim(),
        state: (f[6] ?? '').trim(),
        zip: (f[7] ?? '').trim(),
        country: (f[8] ?? '').trim(),
      })
    }
  }
  const missing = [...target].filter((c) => !companies.has(c))
  console.log(`P_CAGE rows scanned: ${pCageRows}; resolved ${companies.size} of ${target.size}`)
  console.log(`UNRESOLVED (in our data, absent from the CAGE master): ${missing.length}`)

  /* ----------------------------------------------------------------------- 4. write it */
  const outDir = dataPath('flis')
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'cage-index.json')
  const payload = {
    provenance: {
      derivedFrom: [
        { file: 'CAGE.zip::P_CAGE.CSV', rows: pCageRows },
        { file: 'H-SERIES.zip::V_H5_CORPORATE.CSV', rows: h5Rows },
      ],
      sourceDir: SOURCE_DIR,
      /* The measurement that stops the next lane building on an empty column. */
      parentCagePopulated,
      referencedCages: wanted.size,
      resolvedCages: companies.size,
      unresolvedCages: missing.length,
      feedDay: datasets.cornerMap.provenance.feedDay,
    },
    companies: [...companies.values()],
    associations: [...assoc.entries()]
      .filter(([cage]) => target.has(cage))
      .map(([cage, a]) => ({ cage, association: a.association, affiliation: a.affiliation })),
  }
  writeFileSync(outPath, JSON.stringify(payload))
  console.log(`wrote ${outPath} (${(JSON.stringify(payload).length / 1e6).toFixed(1)} MB)`)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
