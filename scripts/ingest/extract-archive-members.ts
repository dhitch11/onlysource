/**
 * T2 INGESTION. Expose the members inside archived zips as stable files on disk.
 *
 *   node --import ./scripts/ingest/ts-resolve.mjs scripts/ingest/extract-archive-members.ts
 *
 * WHY: other lanes need `as260811.txt` and `bq260811.txt` for their own dataset tests, and
 * they have been reading them out of `/tmp`, which macOS purges without warning. A test whose
 * fixture can evaporate is a test that will fail for a reason nobody can reproduce.
 *
 * DERIVED, AND SAID SO. These files are written under `derived/` and are NOT originals. The
 * original published bytes are the zip, and the zip is what the archive protects. Anything
 * here can be regenerated from it, which is exactly why it is safe to regenerate and unsafe
 * to treat as provenance. A consumer wanting to prove what the government published reads the
 * zip and its SHA-256 from `MANIFEST.jsonl`, never these.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

import { ARCHIVE_ROOT } from '../../lib/ingest/db'
import { readZipMembers } from '../../lib/ingest/parse/zip'

type ManifestRow = { source_key: string; logical_date: string; storage_key: string }

async function main(): Promise<void> {
  const manifest = (await readFile(join(ARCHIVE_ROOT, 'MANIFEST.jsonl'), 'utf8'))
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as ManifestRow)

  const zips = manifest.filter((m) => m.storage_key.endsWith('.zip'))
  const written: string[] = []

  for (const row of zips) {
    const buffer = await readFile(join(ARCHIVE_ROOT, row.storage_key))
    const zip = readZipMembers(buffer)

    for (const member of zip.members) {
      if (!member.complete) {
        console.log(`  SKIPPED (cut off mid-stream) ${member.name} in ${row.storage_key}`)
        continue
      }
      // PDFs from the 217-member truncated `ca` package are not exposed here: 216 loose
      // solicitation documents are a different kind of artifact and nobody has asked for
      // them as files. The zip remains the record.
      if (member.name.toLowerCase().endsWith('.pdf')) continue

      const target = join(ARCHIVE_ROOT, 'derived', row.source_key, row.logical_date, member.name)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, member.data)
      const sha = createHash('sha256').update(member.data).digest('hex')
      written.push(
        `  ${member.name.padEnd(18)} ${String(member.data.length).padStart(9)} B  ` +
          `sha ${sha.slice(0, 16)}  from ${row.storage_key}`,
      )
    }
  }

  const readme = join(ARCHIVE_ROOT, 'derived', 'README.md')
  await mkdir(dirname(readme), { recursive: true })
  await writeFile(
    readme,
    [
      '# Derived archive members',
      '',
      '**These are NOT original published bytes.** They are members extracted from the zips in',
      'the archive above, written here so other lanes have a stable path for dataset tests',
      'instead of reading from `/tmp`, which is purged without warning.',
      '',
      'Regenerate at any time:',
      '',
      '```',
      'node --import ./scripts/ingest/ts-resolve.mjs scripts/ingest/extract-archive-members.ts',
      '```',
      '',
      'To prove what the government actually published, read the ZIP and its SHA-256 from',
      '`../MANIFEST.jsonl`. Never cite a file in this directory as provenance.',
      '',
    ].join('\n'),
    'utf8',
  )

  console.log('\n  EXTRACTED (derived, regenerable, not provenance)\n')
  for (const line of written) console.log(line)
  console.log(`\n  ${written.length} member(s) under ${join(ARCHIVE_ROOT, 'derived')}\n`)
}

main().catch((error) => {
  console.error(`extract-archive-members FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
