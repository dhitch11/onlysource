/**
 * T2 INGESTION. RECONCILE WHAT THE MANIFEST CLAIMS AGAINST WHAT THE DISK HOLDS.
 *
 * THE DEFECT THIS EXISTS TO CLOSE, measured on production 2026-08-18: the manifest recorded
 * seven files as `http_status: 200` with a storage key, and 1.47 GB of those bytes were not
 * on the disk. `heldFiles()` built the capture's skip-set from the manifest, so every future
 * capture and backfill would have skipped re-fetching them with no request and no report,
 * permanently, while the bytes did not exist. The manifest is the record of what we WROTE.
 * It is not evidence of what is HERE.
 *
 *   AN INSTRUMENT THAT ONLY EXAMINES ITS OWN HANDIWORK CONFIRMS YOUR WRITE, NOT THE STATE
 *   OF THE SYSTEM.
 *
 * SO THE STATES ARE SIX, NOT TWO, and the distinction between them is the whole value here.
 * "We do not have this file" is three completely different facts with three different
 * owners, and collapsing them is how an operator ends up chasing a data loss that never
 * happened, or ignoring one that did:
 *
 *   held         the manifest recorded it and the bytes are here at the recorded length
 *   truncated    the bytes are here at the WRONG length. Present is not whole: this repo
 *                has a recorded incident where a row-boundary-exact truncation parsed clean
 *                with zero failed assertions, so a short file must never read as held
 *   lost         the manifest recorded an accepted capture and the bytes are gone. OURS.
 *                Recoverable: the origin published it once, so it can be fetched again
 *   not_published  the origin answered 404. THEIRS, and an honest empty state, not a gap.
 *                A day DLA never published is not a day we failed to capture
 *   refused      the origin refused for a reason that is not absence (WAF, transport).
 *                Needs an operator; silence here is how a block becomes a habit
 *   never_asked  no row at all. We have not looked, which is not the same as looking and
 *                finding nothing
 *
 * PURE AND INJECTABLE. It takes rows and a root and returns a description; it opens no
 * network connection and writes nothing. The stat function is a parameter so a test can
 * drive every state without staging gigabytes, and so the real implementation stays one
 * line that a reader can check by eye.
 */

import { readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

import type { ArchiveRecord, ManifestEntry, RejectionRecord } from './archive'

export const DIBBS_SOURCE_KEY = 'dibbs-rfq-daily'

export type HoldingState =
  | 'held'
  | 'truncated'
  | 'lost'
  | 'not_published'
  | 'refused'
  | 'never_asked'

/** States in which we hold usable bytes. The only ones a capture may skip. */
export const HOLDING_STATES_WITH_BYTES: readonly HoldingState[] = ['held']

/**
 * HOW WELL WE KNOW A FILE, which is a different question from whether we hold it.
 *
 * ★ THE INCIDENT THAT MADE THIS NECESSARY, 2026-08-19. `ca260811.zip` sat on disk at exactly
 * the 56,826,248 bytes its manifest row recorded, so it reported `held`. Re-fetching it from
 * the origin returned 712,059,275 bytes. WE WERE HOLDING 8% OF THE FILE AND CALLING IT
 * COMPLETE. The length check could not see it, because the row was written from the same bad
 * observation that produced the file, so the file and the record agreed and both were wrong.
 *
 *   A LENGTH CHECK VALIDATES INTERNAL CONSISTENCY, NOT COMPLETENESS. AGREEMENT BETWEEN TWO
 *   ARTIFACTS PRODUCED BY THE SAME FLAWED ACT IS NOT CORROBORATION.
 *
 * The tell was already in the data and nothing read it. Every OTHER file re-fetched
 * byte-identical days later; the single row that differed was the single row whose
 * `retrieval_method` was `research_capture` with `retrieved_at_basis: origin_file_mtime` -- a
 * file somebody salvaged off a disk -- rather than `pipeline_fetch` / `http_response`, a gated
 * fetch with an origin Content-Length behind it. Those are different evidentiary grades.
 *
 * THIS IS A TIER, NOT A SEVENTH STATE, and the distinction is load-bearing: STATES describe
 * what we hold, GRADES describe how well we know it, and a file can be perfectly `held` at a
 * grade nobody should bid money on. Merging them loses both.
 */
export type EvidenceGrade =
  /** A gated fetch: the origin answered over HTTP and the response described its own length. */
  | 'gated'
  /** Salvaged: a file recovered from somewhere, timestamped by something other than a response. */
  | 'salvaged'
  /** No row, or a row whose provenance fields we do not recognise. Never assume the better one. */
  | 'unknown'

/**
 * Grade a row by HOW it was observed, never by how healthy it looks.
 *
 * Defaults to `unknown` rather than `gated`, because an unrecognised provenance is exactly the
 * case where assuming the better grade is most expensive. This repo has already shipped a
 * fail-open default that coerced an unknown role to an eight-permission operator.
 */
export function gradeOf(record: {
  retrieval_method?: string | null
  retrieved_at_basis?: string | null
}): EvidenceGrade {
  const method = record.retrieval_method ?? ''
  const basis = record.retrieved_at_basis ?? ''
  if (method === 'pipeline_fetch' && basis === 'http_response') return 'gated'
  if (method === 'research_capture') return 'salvaged'
  return 'unknown'
}

export type FileReconciliation = {
  sourceKey: string
  logicalDate: string
  filename: string
  state: HoldingState
  /** Null for refusals, which are never written under a data storage key. */
  storageKey: string | null
  /** What the manifest says the file weighs. Null when nothing was accepted. */
  expectedBytes: number | null
  /** What the disk says it weighs. Null when it is not there. */
  actualBytes: number | null
  /** How well we know this file. Independent of whether we hold it. */
  grade: EvidenceGrade
  detail: string
}

export type ArchiveReconciliation = {
  root: string
  files: FileReconciliation[]
  counts: Record<HoldingState, number>
  /**
   * `logical_date/filename` for every file whose bytes are present AND whole. This is the
   * capture's skip-set, and it is derived from the disk, never from the record.
   */
  heldKeys: Set<string>
  /** Files the manifest accepted whose bytes are gone. The recoverable loss. */
  lost: FileReconciliation[]
  /** Files present at the wrong length. Present is not whole. */
  truncated: FileReconciliation[]
  /** Bytes the manifest claims and the disk does not hold. */
  lostBytes: number
  /** How many files sit at each evidence grade. */
  grades: Record<EvidenceGrade, number>
  /**
   * Files we HOLD but at a grade below a gated fetch. These are the ones a recommendation an
   * operator actually bids must be able to refuse, and the ones an operator surface should
   * name rather than fold into a clean-looking total.
   */
  heldButUngated: FileReconciliation[]
}

/**
 * Injectable so tests can drive every state without staging real gigabytes.
 *
 * IT RETURNS A SIZE RATHER THAN A BOOLEAN because this module has to tell `lost` (nothing
 * there) from `truncated` (something there, wrong length), and the archive WRITER only has
 * to answer yes or no. That is why `archive.ts` exports the boolean `bytesHeldAt()` and this
 * module keeps its own injectable stat instead of importing it: two different questions, and
 * forcing one signature on both would cost the reconciler its testability.
 *
 * THE RISK THAT CREATES IS DRIFT, and drift between a reader and a writer about what
 * "holding a file" means is the exact defect this whole commit exists to close. So it is
 * closed by a test, not by a comment: `test/t2-ingest/archive-write-orphan.test.ts` asserts
 * that `bytesHeldAt()` is true for precisely the files this module calls `held`, over the
 * same staged archive.
 */
export type StatFile = (path: string) => { size: number } | null

export const realStatFile: StatFile = (path) => {
  try {
    const s = statSync(path)
    return s.isFile() ? { size: s.size } : null
  } catch {
    return null
  }
}

function isRejection(entry: ManifestEntry): entry is RejectionRecord {
  return (entry as { kind?: string }).kind === 'rejected'
}

const basename = (key: string): string => key.split('/').pop() ?? ''

export const reconciliationKey = (logicalDate: string, filename: string): string =>
  `${logicalDate}/${filename}`

/**
 * Precedence when several rows describe the same file. A file we can prove is on disk
 * outranks any recorded refusal of it, because a later successful capture is the newer
 * truth and the manifest is append-only. `lost` outranks `not_published` for the same
 * reason: an accepted capture proves the origin published it at least once, so a later 404
 * describes the retention window closing, not a day that never existed.
 */
const PRECEDENCE: Record<HoldingState, number> = {
  held: 6,
  truncated: 5,
  lost: 4,
  refused: 3,
  not_published: 2,
  never_asked: 1,
}

/**
 * Reconcile every manifest row against the bytes on disk.
 *
 * Rows are collapsed per (source_key, logical_date, filename) by the precedence above, so a
 * day captured twice, or refused once and captured later, reports the state that is
 * actually true now rather than the last row that happened to be appended.
 */
export function reconcileArchive(
  entries: readonly ManifestEntry[],
  root: string,
  statFile: StatFile = realStatFile,
): ArchiveReconciliation {
  const best = new Map<string, FileReconciliation>()

  const consider = (r: FileReconciliation): void => {
    const key = `${r.sourceKey}::${reconciliationKey(r.logicalDate, r.filename)}`
    const prior = best.get(key)
    if (!prior || PRECEDENCE[r.state] > PRECEDENCE[prior.state]) best.set(key, r)
  }

  for (const entry of entries) {
    if (isRejection(entry)) {
      const rejection = entry
      // `not_published` is the origin saying the file does not exist. Every other refusal
      // is something that went wrong between us and it, and those are not the same fact.
      const state: HoldingState = rejection.verdict === 'not_published' ? 'not_published' : 'refused'
      consider({
        sourceKey: rejection.source_key,
        logicalDate: rejection.logical_date,
        filename: rejection.filename,
        state,
        storageKey: null,
        expectedBytes: null,
        actualBytes: null,
        grade: gradeOf(rejection as { retrieval_method?: string; retrieved_at_basis?: string }),
        detail:
          state === 'not_published'
            ? `the origin answered ${rejection.http_status ?? 'a refusal'}: not published or outside the retention window`
            : `refused: ${rejection.reason}`,
      })
      continue
    }

    const record = entry as ArchiveRecord
    const filename = basename(record.storage_key)
    const stat = statFile(join(root, record.storage_key))

    if (stat === null) {
      consider({
        sourceKey: record.source_key,
        logicalDate: record.logical_date,
        filename,
        state: 'lost',
        storageKey: record.storage_key,
        expectedBytes: record.byte_len,
        actualBytes: null,
        grade: gradeOf(record),
        detail: `the manifest records an accepted capture of ${record.byte_len.toLocaleString('en-US')} bytes and the file is not on disk`,
      })
      continue
    }

    if (stat.size !== record.byte_len) {
      consider({
        sourceKey: record.source_key,
        logicalDate: record.logical_date,
        filename,
        state: 'truncated',
        storageKey: record.storage_key,
        expectedBytes: record.byte_len,
        actualBytes: stat.size,
        grade: gradeOf(record),
        detail: `on disk at ${stat.size.toLocaleString('en-US')} bytes, the manifest recorded ${record.byte_len.toLocaleString('en-US')}`,
      })
      continue
    }

    consider({
      sourceKey: record.source_key,
      logicalDate: record.logical_date,
      filename,
      state: 'held',
      storageKey: record.storage_key,
      expectedBytes: record.byte_len,
      actualBytes: stat.size,
      grade: gradeOf(record),
      detail: `present at the recorded length`,
    })
  }

  const files = [...best.values()].sort(
    (a, b) =>
      a.logicalDate.localeCompare(b.logicalDate) ||
      a.sourceKey.localeCompare(b.sourceKey) ||
      a.filename.localeCompare(b.filename),
  )

  const counts: Record<HoldingState, number> = {
    held: 0,
    truncated: 0,
    lost: 0,
    not_published: 0,
    refused: 0,
    never_asked: 0,
  }
  for (const f of files) counts[f.state] += 1

  const lost = files.filter((f) => f.state === 'lost')
  const truncated = files.filter((f) => f.state === 'truncated')
  const grades: Record<EvidenceGrade, number> = { gated: 0, salvaged: 0, unknown: 0 }
  for (const f of files) grades[f.grade] += 1

  return {
    root,
    files,
    counts,
    heldKeys: new Set(
      files.filter((f) => f.state === 'held').map((f) => reconciliationKey(f.logicalDate, f.filename)),
    ),
    lost,
    truncated,
    lostBytes: lost.reduce((sum, f) => sum + (f.expectedBytes ?? 0), 0),
    grades,
    heldButUngated: files.filter((f) => f.state === 'held' && f.grade !== 'gated'),
  }
}

/**
 * The state of one specific file. `never_asked` when no row describes it, which is the
 * honest answer for a file nobody has ever requested and is not the same as a refusal.
 */
export function stateFor(
  reconciliation: ArchiveReconciliation,
  sourceKey: string,
  logicalDate: string,
  filename: string,
): HoldingState {
  const hit = reconciliation.files.find(
    (f) => f.sourceKey === sourceKey && f.logicalDate === logicalDate && f.filename === filename,
  )
  return hit?.state ?? 'never_asked'
}

/**
 * One line per non-held state, for an operator reading a capture log. Returns an empty
 * array when everything reconciles, so a healthy run stays quiet and an unhealthy one
 * cannot be silent: a run that quietly starts re-fetching 1.47 GB is very nearly as
 * surprising as one that quietly skips it.
 */
export function reconciliationReport(
  reconciliation: ArchiveReconciliation,
  sourceKey: string = DIBBS_SOURCE_KEY,
): string[] {
  const mine = reconciliation.files.filter((f) => f.sourceKey === sourceKey)
  const lost = mine.filter((f) => f.state === 'lost')
  const truncated = mine.filter((f) => f.state === 'truncated')
  if (lost.length === 0 && truncated.length === 0) return []

  const lines: string[] = []
  if (lost.length > 0) {
    const bytes = lost.reduce((s, f) => s + (f.expectedBytes ?? 0), 0)
    lines.push(
      `archive reconciliation: ${lost.length} file(s) the manifest accepted are NOT on disk ` +
        `(${bytes.toLocaleString('en-US')} bytes). They are no longer treated as held and will be re-fetched:`,
    )
    for (const f of lost) lines.push(`  LOST ${f.logicalDate} ${f.filename} - ${f.detail}`)
  }
  if (truncated.length > 0) {
    lines.push(
      `archive reconciliation: ${truncated.length} file(s) are on disk at the wrong length. ` +
        `Present is not whole; they will be re-fetched:`,
    )
    for (const f of truncated) lines.push(`  TRUNCATED ${f.logicalDate} ${f.filename} - ${f.detail}`)
  }
  return lines
}

/* ------------------------------------------------------------------------------------ */
/* THE OTHER DIRECTION. THE MANIFEST CANNOT REPORT A FILE IT NEVER HEARD OF               */
/* ------------------------------------------------------------------------------------ */

export type OrphanFile = { storageKey: string; bytes: number }

/**
 * Files on disk that NO manifest row claims.
 *
 * ★ WHY THIS EXISTS, AND WHY ITS ABSENCE WAS A REAL GAP. `reconcileArchive` walks manifest
 * rows and asks the disk about each one. That direction catches a row whose bytes are gone.
 * It is structurally incapable of catching the opposite: bytes with no row. An orphan is
 * invisible to it no matter how large, because the walk never starts from a file.
 *
 * On 2026-08-19 a memory watchdog killed a capture mid-run, which is precisely how an orphan
 * gets made: `archiveBytes` writes the file, verifies it, and only THEN appends the row, so a
 * kill in that gap leaves bytes nothing references. That write ordering is deliberate and
 * correct -- record-first would have manufactured a row vouching for bytes that were never
 * written, which is the defect this whole module exists to close -- and the price of the
 * correct ordering is that orphans are possible. So they must be findable.
 *
 * An orphan is not corruption. It is unreferenced disk that no reader will ever open and no
 * cleanup will ever dare remove without knowing it is unreferenced. Reported, never deleted:
 * this module does not remove anything, and nothing on this estate deletes archive bytes.
 */
export function findOrphans(
  entries: readonly ManifestEntry[],
  files: readonly { storageKey: string; bytes: number }[],
): OrphanFile[] {
  const claimed = new Set<string>()
  for (const e of entries) {
    const key = (e as { storage_key?: string }).storage_key
    if (typeof key === 'string' && key !== '') claimed.add(key)
  }
  return files
    .filter((f) => !claimed.has(f.storageKey))
    .map((f) => ({ storageKey: f.storageKey, bytes: f.bytes }))
    .sort((a, b) => a.storageKey.localeCompare(b.storageKey))
}

/**
 * Walk an archive root and list every file, as storage keys relative to that root, so the
 * result can be handed straight to `findOrphans`. The manifest itself is not a storage key
 * and is excluded; it is the ledger, not an archived artifact.
 */
export function listArchiveFiles(root: string): { storageKey: string; bytes: number }[] {
  const out: { storageKey: string; bytes: number }[] = []
  const walk = (dir: string, rel: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[]
    } catch {
      return // an unreadable directory is reported as no files, never as an exception
    }
    for (const e of entries) {
      const child = join(dir, e.name)
      const key = rel === '' ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) {
        walk(child, key)
      } else if (e.isFile() && key !== 'MANIFEST.jsonl') {
        const stat = realStatFile(child)
        if (stat) out.push({ storageKey: key, bytes: stat.size })
      }
    }
  }
  walk(root, '')
  return out
}

/**
 * One line per file we hold at a grade below a gated fetch, plus any orphans.
 *
 * SEPARATE FROM `reconciliationReport` ON PURPOSE. That one names files we must re-fetch: it
 * is a work list. This one names files whose CONTENT we cannot vouch for and bytes nothing
 * references: it is a confidence statement. Folding them together would make an operator read
 * "we are missing things" when the truth is "we have something we should not fully trust",
 * and those need different responses.
 *
 * Returns an empty array when everything is gated and nothing is orphaned, so a healthy
 * archive stays quiet and an unhealthy one cannot be silent.
 */
export function provenanceReport(
  reconciliation: ArchiveReconciliation,
  orphans: readonly OrphanFile[] = [],
): string[] {
  const lines: string[] = []
  if (reconciliation.heldButUngated.length > 0) {
    lines.push(
      `archive provenance: ${reconciliation.heldButUngated.length} file(s) are held at a grade below ` +
        `a gated fetch. They match their recorded length, which proves the record and the disk ` +
        `agree, NOT that the capture was complete:`,
    )
    for (const f of reconciliation.heldButUngated) {
      lines.push(
        `  ${f.grade.toUpperCase()} ${f.logicalDate} ${f.filename} - recorded ` +
          `${(f.expectedBytes ?? 0).toLocaleString('en-US')} bytes by a ${f.grade} observation`,
      )
    }
  }
  if (orphans.length > 0) {
    const bytes = orphans.reduce((s, o) => s + o.bytes, 0)
    lines.push(
      `archive orphans: ${orphans.length} file(s) on disk that no manifest row claims ` +
        `(${bytes.toLocaleString('en-US')} bytes). Reported, never removed:`,
    )
    for (const o of orphans) lines.push(`  ORPHAN ${o.storageKey} (${o.bytes.toLocaleString('en-US')} bytes)`)
  }
  return lines
}
