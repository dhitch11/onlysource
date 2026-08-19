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
 * =======================================================================================
 * ★★ 2026-08-19: THE INDEX NOW COVERS THE WHOLE CATALOGUE, AND THE FORMAT HAD TO CHANGE
 *     WITH IT. THE SECOND HALF OF THAT SENTENCE IS THE LOAD-BEARING PART.
 * =======================================================================================
 * This script used to scope itself to NIINs seen in our own archived DIBBS days, which held
 * it at 28,119. That was correct while the product screened the daily solicitation FLOW. It
 * is wrong now that the product screens the standing CATALOGUE: the corner board ran against
 * 273 positions while `V_MOE_RULE.CSV` publishes 5,479,581 NIINs carrying an AMSC, of which
 * 191,667 are AMC 5 (sole source and not the manufacturer) and 852,299 are AMC 1|2 with
 * AMSC G|Z. The catalogue was never the constraint. It is free, we already hold it, and it
 * is republished monthly.
 *
 * BUT WIDENING THE SCOPE ALONE WOULD HAVE KILLED PRODUCTION, and this is measured rather
 * than feared. The consumer built `rows: Map<string, AmscIndexRow>` by `JSON.parse` of the
 * entire file and held every row resident. At 28,119 rows that is a 1.77 MB file. At
 * 5,479,581 it is roughly 380 MB of JSON parsed into on the order of 1.5 GB of JS Map,
 * string keys and row objects. **Production is a 2 GB box shared with Next.js.** Removing
 * the filter without changing the storage does not produce a bigger index; it produces an
 * out-of-memory kill. So the format changes in the same commit as the scope, on purpose.
 *
 * THE FORMAT: `amsc-index.bin`, fixed 8-byte records SORTED BY NIIN.
 *
 *     bytes 0..3   uint32BE   NIIN, all nine digits (max 999,999,999 < 2^32)
 *     byte  4      uint8      AMC  as its ASCII code, 0 when absent
 *     byte  5      uint8      AMSC as its ASCII code, 0 when absent
 *     byte  6      uint8      AAC  as its ASCII code, 0 when absent
 *     byte  7      uint8      reserved, always 0
 *     bytes 8..9   uint16BE   index into the PICA dictionary in the sidecar, 0 when absent
 *
 * ★ THE PICA FIELD IS TWO BYTES BECAUSE A SEVEN-BIT ONE WAS TRIED AND REFUSED TO LIE.
 * The first cut of this file gave PICA seven bits, on the assumption that a handful of
 * inventory control activities publish the catalogue. The derivation aborted on the real
 * file at the 128th distinct PICA ("TV") rather than truncating the dictionary, because a
 * truncated dictionary does not lose data visibly: it silently relabels who manages an item,
 * and who manages an item IS the input to the publisher test that decides whether a blank
 * AMSC means "unrestricted" or "this activity does not publish". The guard was written
 * before the run and it fired on the first one. Assume nothing about cardinality you have
 * not counted.
 *
 * 5.5M records is ~55 MB on disk and ZERO resident, because the reader binary-searches a
 * file descriptor: about 23 reads of 8 bytes to resolve one NIIN. Chosen over holding the
 * buffer in memory because of the 2 GB box, and over a real datastore because this is a
 * read-only monthly catalogue and adding a database to serve a sorted array of 8-byte
 * records is the heavier answer to the easier question.
 *
 * EVERY ROW IS WRITTEN, not a curated subset. A "useful subset" is a hardcoded list with a
 * delay on it: the first NIIN we get demand for that falls outside it resolves as
 * `abstained_not_in_catalogue`, which is the product saying "the government does not publish
 * this" when the truth is "we filtered it out". That is the same class of error as reading a
 * blank AMSC as unrestricted, which this file already argues against at length.
 *
 * MEMORY HERE, since this is the one place it is spent: one pass streams every MOE row into
 * a packed 8-byte scratch record, so peak is about 8 bytes x rows (~146 MB at 18.2M) plus
 * the sort, and no per-row JS object is ever allocated. It is an offline derivation run on a
 * workstation, not on the droplet.
 *
 * USAGE:  npx tsx scripts/flis/derive-amsc-index.mts
 * INPUT:  ~/onlysource-data/flis/MOE_RULE.zip   (or FLIS_SOURCE_DIR)
 * OUTPUT: <data root>/flis/amsc-index.bin  +  <data root>/flis/amsc-index.meta.json
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

import { dataPath } from '../../lib/data-root'

const SOURCE_DIR = process.env.FLIS_SOURCE_DIR ?? path.join(os.homedir(), 'onlysource-data', 'flis')


/**
 * ★ THE GOVERNMENT PUBLISHES ITS OWN CODE FOR "NOTHING", AND JAVASCRIPT CALLS IT TRUE.
 *
 * FLIS writes `"0"` for a code that has NOT BEEN ASSIGNED. `DoD 4100.39-M Volume 10, Chapter 4,
 * Table 71` states it for AMC as `0 = Not established.` It is a stated absence, not a value.
 *
 * `if (amsc)` cannot tell `"G"` from `"0"`, because a non-empty string is truthy. So a stated
 * absence was being recorded as a determination, and the consequences were measured on the
 * built artifact rather than argued:
 *
 *   AMSC "any non-empty"         5,479,581
 *   AMSC == "0", not assigned    1,060,757   <- 19.4% of the headline
 *   AMSC actually determined     4,418,824
 *
 * It also contaminated the publisher set, which is this file's whole mechanism: a PICA is
 * treated as authoritative when it publishes AMSC on most of its rows, and PICAs that publish
 * nothing but the sentinel were qualifying. And in `rankOf` below, a sentinel row scored as a
 * publisher-with-AMSC row, tied with a genuine `AMC 5 / AMSC H` determination, and the tie broke
 * on file position -- silently discarding 175 real AMC-5 NIINs, the highest-margin corner class
 * in the product, on the 46% of NIINs that appear under more than one MOE rule.
 *
 * THE CODE IS STILL STORED. `"0"` is a real thing the government said and the index keeps it, so
 * a consumer can distinguish three states rather than two: byte 0 = the field was empty, byte
 * '0' = the government recorded NOT ASSIGNED, a letter = a determination. What changes is that
 * only the third counts as evidence.
 */
/**
 * Flags in what used to be the record's reserved byte. Zero means nothing is contested, so
 * every existing reader that ignores byte 7 keeps working unchanged.
 */
export const FLAG_AMC_CONTESTED = 1
export const FLAG_AMSC_CONTESTED = 2
export const FLAG_SELF_CONTRADICTION = 4

const NOT_ASSIGNED = '0'
const isDetermined = (code: string): boolean => code !== '' && code !== NOT_ASSIGNED

/** A PICA must publish AMSC on at least this share of its rows to be treated as a publisher. */
const PUBLISHER_THRESHOLD = 0.5
/** and on at least this many rows, so a PICA with three rows cannot become a "publisher". */
const PUBLISHER_MIN_ROWS = 1000

/**
 * The scratch word is (NIIN << 32) | SEQUENCE, so the whole file sorts as a BigUint64Array
 * with the platform's native numeric sort and no comparator, and every row of one NIIN lands
 * in a contiguous run IN FILE ORDER. The row's codes live in a parallel Uint32Array indexed
 * by that sequence number:
 *
 *     bit  31      this row carries an AMSC
 *     bits 30..21  PICA dictionary index (10 bits, measured cardinality is 134)
 *     bits 20..14  AMC  ASCII (7 bits: the codes are alphanumeric, all below 128)
 *     bits 13..7   AMSC ASCII (7 bits)
 *     bits 6..0    AAC  ASCII (7 bits)
 *
 * ★ WHY THE ROW IS CHOSEN AFTER THE SORT INSTEAD OF DURING IT, which is the correction that
 * this design exists to make. An item appears under several MOE rules and only the managing
 * activity's row carries meaningful acquisition codes, so the pick matters. A first attempt
 * put an "has an AMSC" bit at the top of the sort word and took the last record of each run,
 * which is comparator-free and WRONG: among several rows that all carry an AMSC the tie then
 * breaks on the remaining packed bits, which is arbitrary. Cross-checked against the previous
 * index it disagreed on 704 of 28,119 NIINs, and it disagreed in the damaging direction: on
 * NIIN 000018645 it chose a row from PICA "92" over the GX row, discarding AMC 1 / AMSC C in
 * favour of an activity that publishes nothing. **A tie-break that is arbitrary is a tie-break
 * that is sometimes catastrophic**, because the whole downstream question is which activity
 * manages the item.
 *
 * So the run is ranked deliberately, and the rank encodes the intent the old code only
 * approximated: a row from a MEASURED PUBLISHER carrying an AMSC beats a row carrying an AMSC
 * from anyone else, which beats a publisher's row without one, which beats anything. Ties go
 * to the earliest row in the file so the result is reproducible run to run. The publisher set
 * is known by the time this runs, because it is measured in the same streaming pass.
 */
const PICA_DICT_LIMIT = 1023 // 10 bits. Exceeding it is a hard failure, never a silent truncation.
const RECORD_BYTES = 10

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

/** A growable little-endian scratch buffer of (sequence, niin) uint32 pairs. */
class ScratchRecords {
  private buf: Buffer
  private n = 0
  constructor(initialRecords = 1 << 21) {
    this.buf = Buffer.allocUnsafe(initialRecords * 8)
  }
  push(niin: number, seq: number): void {
    if ((this.n + 1) * 8 > this.buf.length) {
      const next = Buffer.allocUnsafe(this.buf.length * 2)
      this.buf.copy(next, 0, 0, this.n * 8)
      this.buf = next
    }
    // LOW word first, so a little-endian 64-bit read yields (niin << 32) | seq and the sort
    // therefore orders by NIIN first and by original file position second.
    this.buf.writeUInt32LE(seq >>> 0, this.n * 8)
    this.buf.writeUInt32LE(niin >>> 0, this.n * 8 + 4)
    this.n += 1
  }
  get count(): number { return this.n }
  /** A BigUint64Array view over exactly the written records. */
  view(): BigUint64Array {
    const bytes = this.n * 8
    const aligned = this.buf.byteOffset % 8 === 0
    const ab = aligned
      ? this.buf.buffer.slice(this.buf.byteOffset, this.buf.byteOffset + bytes)
      : Uint8Array.prototype.slice.call(this.buf, 0, bytes).buffer
    return new BigUint64Array(ab)
  }
}

async function main(): Promise<void> {
  const moePath = path.join(SOURCE_DIR, 'MOE_RULE.zip')
  if (!existsSync(moePath)) {
    console.error(`MISSING: ${moePath}\nSee memory project_onlysource_flis_publog_acquisition_2026_08_17.`)
    process.exit(1)
  }

  /* ------------------------------------------------ 1. one streaming pass over every row */
  const scratch = new ScratchRecords()
  /** Row codes, indexed by the sequence number stored in the sort word. */
  let payloads = new Uint32Array(1 << 21)
  const picaRows = new Map<string, { rows: number; withAmsc: number }>()
  const picaIndex = new Map<string, number>() // '' is never assigned; 0 means absent
  const picaList: string[] = []
  let total = 0
  let skippedNiin = 0
  let header: string[] | null = null
  let iN = 0, iA = 0, iS = 0, iC = 0, iP = 0
  const t0 = process.hrtime.bigint()

  for await (const line of zipMemberLines(moePath, 'V_MOE_RULE.CSV')) {
    const f = splitCsvLine(line)
    if (!header) {
      header = f.map((x) => x.trim().replace(/^"|"$/g, ''))
      iN = header.indexOf('NIIN'); iA = header.indexOf('AMC'); iS = header.indexOf('AMSC')
      iC = header.indexOf('AAC'); iP = header.indexOf('PICA')
      if ([iN, iA, iS, iC, iP].some((i) => i < 0)) {
        console.error(`HEADER CHANGED. Expected NIIN/AMC/AMSC/AAC/PICA, got: ${header.join(',')}`)
        process.exit(1)
      }
      continue
    }
    total += 1
    if (f.length <= Math.max(iN, iA, iS, iC, iP)) continue

    const pica = (f[iP] ?? '').trim()
    const amsc = (f[iS] ?? '').trim()
    const stat = picaRows.get(pica) ?? { rows: 0, withAmsc: 0 }
    stat.rows += 1
    // A PICA that emits nothing but the not-assigned sentinel publishes NOTHING.
    if (isDetermined(amsc)) stat.withAmsc += 1
    picaRows.set(pica, stat)

    const niinText = (f[iN] ?? '').trim()
    // Nine digits, no other shape. A NIIN we cannot parse is COUNTED and dropped rather than
    // coerced, because a coerced key silently points a real lookup at the wrong item.
    if (niinText.length !== 9 || !/^\d{9}$/.test(niinText)) { skippedNiin += 1; continue }
    const niin = Number(niinText)

    let picaIdx = 0
    if (pica) {
      const known = picaIndex.get(pica)
      if (known !== undefined) picaIdx = known
      else {
        if (picaList.length + 1 > PICA_DICT_LIMIT) {
          console.error(
            `PICA dictionary exceeded ${PICA_DICT_LIMIT} entries at "${pica}". The scratch word gives ` +
              `PICA seven bits. Widen the record rather than truncating the dictionary: a truncated ` +
              `dictionary silently mislabels who manages an item, which is the input to the publisher test.`,
          )
          process.exit(1)
        }
        picaList.push(pica)
        picaIdx = picaList.length // 1-based; 0 stays "absent"
        picaIndex.set(pica, picaIdx)
      }
    }

    const amc = (f[iA] ?? '').trim()
    const aac = (f[iC] ?? '').trim()
    const payload =
      // Bit 31 is the EVIDENCE flag used by rankOf, not a presence flag. The sentinel is
      // stored in the amsc byte below, but it must never rank as a determination.
      (((isDetermined(amsc) ? 1 : 0) << 31) |
        ((picaIdx & 0x3ff) << 21) |
        ((amc ? amc.charCodeAt(0) & 0x7f : 0) << 14) |
        ((amsc ? amsc.charCodeAt(0) & 0x7f : 0) << 7) |
        (aac ? aac.charCodeAt(0) & 0x7f : 0)) >>>
      0
    if (scratch.count >= payloads.length) {
      const grown = new Uint32Array(payloads.length * 2)
      grown.set(payloads)
      payloads = grown
    }
    payloads[scratch.count] = payload
    scratch.push(niin, scratch.count)
  }

  const streamedMs = Number(process.hrtime.bigint() - t0) / 1e6
  console.log(`MOE rows scanned: ${total.toLocaleString()} in ${(streamedMs / 1000).toFixed(1)}s`)
  console.log(`rows with a well-formed 9-digit NIIN: ${scratch.count.toLocaleString()} (dropped ${skippedNiin.toLocaleString()})`)

  /* ------------------------------------------------------- 2. sort, then dedup in one walk */
  const words = scratch.view()
  words.sort()
  const recs = words.length

  /* The publisher set must exist BEFORE the pick, because the pick uses it. */
  const publisherIdx = new Set<number>()
  for (const [pica, st] of picaRows) {
    const rate = st.rows ? st.withAmsc / st.rows : 0
    if (st.rows >= PUBLISHER_MIN_ROWS && rate >= PUBLISHER_THRESHOLD) {
      const idx = picaIndex.get(pica)
      if (idx !== undefined) publisherIdx.add(idx)
    }
  }
  /** Higher wins. Encodes "the managing activity's row", not "whichever sorted last". */
  const rankOf = (payload: number): number => {
    const hasAmsc = (payload >>> 31) & 1
    const fromPublisher = publisherIdx.has((payload >>> 21) & 0x3ff) ? 1 : 0
    return hasAmsc && fromPublisher ? 3 : hasAmsc ? 2 : fromPublisher ? 1 : 0
  }

  const out = Buffer.allocUnsafe(recs * RECORD_BYTES) // upper bound; sliced to the real count below
  let written = 0
  let withAmsc = 0
  let multiRule = 0
  let contestedAmc = 0
  let contestedAmsc = 0
  let selfContradiction = 0
  for (let i = 0; i < recs; ) {
    const niin = Number(words[i]! >> 32n)
    // The run of every row for this NIIN, already in file order.
    let j = i
    let best = Number(words[i]! & 0xffffffffn)
    let bestRank = rankOf(payloads[best]!)
    while (j + 1 < recs && Number(words[j + 1]! >> 32n) === niin) {
      j += 1
      const seq = Number(words[j]! & 0xffffffffn)
      const r = rankOf(payloads[seq]!)
      if (r > bestRank) { best = seq; bestRank = r } // strictly greater: ties keep the earliest
    }
    if (j > i) multiRule += 1

    /*
     * ★ A TIE BROKEN ON FILE POSITION IS AN ARBITRARY CHOICE, AND IT WAS BEING RENDERED AS A
     * GOVERNMENT FACT. When two rows reach the SAME top rank -- both determinations, both from
     * publishing activities -- the walk above keeps the earliest. That is fine when they agree,
     * and it is a coin flip when they do not.
     *
     * MEASURED over the whole catalogue before building this: 3,260,593 NIINs carry more than
     * one MOE rule and 1,076,346 produce a genuine tie, but in 99.99% of those the tied rows
     * AGREE. Only 116 disagree on AMC and 319 on AMSC. EXPOSURE IS NOT HARM, and the difference
     * between "46% of the catalogue is at risk" and "107 items" is the difference between a
     * rewrite and an afternoon.
     *
     * 116 is not zero, so the honest answer is one bit rather than a silent pick: the record
     * says the authorities disagree and a surface can abstain or show both, instead of printing
     * whichever row the government happened to write first.
     *
     * SELF-CONTRADICTION IS RECORDED SEPARATELY because it is not a tie at all. Twenty-four NIINs
     * carry two top-rank rows from the SAME activity that disagree with each other -- that is a
     * data-quality signal about the source, not an ambiguity between two sources, and an
     * operator should be able to see the difference.
     */
    /*
     * ★ ONLY A TIE THAT CARRIES A DETERMINATION CAN BE CONTESTED, AND MEASURING THIS BEFORE
     * SHIPPING IS WHAT SAVED THE FLAG FROM BEING USELESS. Counting every top-rank tie whose
     * rows disagree on AMC gives 68,474. Broken down by what that top rank actually IS:
     *
     *     rank 3  two authoritative determinations disagree :      107
     *     rank 2  a determination, non-publishing activity  :        9
     *     rank 0  NEITHER row determined anything at all    :   68,358
     *
     * The 68,358 are rows where no acquisition method was established by anybody, so "two
     * non-authorities disagree about an undetermined item" is not a finding, it is noise. A
     * flag that fires on one percent of the catalogue for no reason is a flag an operator
     * learns to ignore, and then it is worth less than nothing because it is still on screen.
     *
     * So the flag requires bestRank >= 2: the row we are about to publish carries a
     * determination, and another row disputes it. 116 items, and every one of them is a real
     * disagreement about a real answer.
     */
    let flags = 0
    if (j > i && bestRank >= 2) {
      let amcSeen = -1
      let amscSeen = -1
      let picaSeen = -1
      let sameActivity = true
      for (let k = i; k <= j; k += 1) {
        const seq = Number(words[k]! & 0xffffffffn)
        const pl = payloads[seq]!
        if (rankOf(pl) !== bestRank) continue
        const amc = (pl >>> 14) & 0x7f
        const amsc = (pl >>> 7) & 0x7f
        const pica = (pl >>> 21) & 0x3ff
        if (amcSeen === -1) { amcSeen = amc; amscSeen = amsc; picaSeen = pica; continue }
        if (amc !== amcSeen) flags |= FLAG_AMC_CONTESTED
        if (amsc !== amscSeen) flags |= FLAG_AMSC_CONTESTED
        if (pica !== picaSeen) sameActivity = false
      }
      if (flags !== 0 && sameActivity) flags |= FLAG_SELF_CONTRADICTION
      if (flags & FLAG_AMC_CONTESTED) contestedAmc += 1
      if (flags & FLAG_AMSC_CONTESTED) contestedAmsc += 1
      if (flags & FLAG_SELF_CONTRADICTION) selfContradiction += 1
    }

    const payload = payloads[best]!
    i = j + 1
    const o = written * RECORD_BYTES
    out.writeUInt32BE(niin, o)
    out.writeUInt8((payload >>> 14) & 0x7f, o + 4) // AMC
    out.writeUInt8((payload >>> 7) & 0x7f, o + 5)  // AMSC
    out.writeUInt8(payload & 0x7f, o + 6)          // AAC
    out.writeUInt8(flags, o + 7)                   // flags (was reserved; 0 = nothing contested)
    out.writeUInt16BE((payload >>> 21) & 0x3ff, o + 8) // PICA dictionary index
    if ((payload >>> 31) & 1) withAmsc += 1
    written += 1
  }

  console.log(`NIINs appearing under more than one MOE rule: ${multiRule.toLocaleString()}`)
  console.log(`   of those, the top-rank rows DISAGREE on AMC:  ${contestedAmc.toLocaleString()}`)
  console.log(`   of those, the top-rank rows DISAGREE on AMSC: ${contestedAmsc.toLocaleString()}`)
  console.log(`   ...and one activity contradicts ITSELF:       ${selfContradiction.toLocaleString()}`)

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
  console.log(`PICAs that PUBLISH AMSC (>=${PUBLISHER_MIN_ROWS} rows, >=${PUBLISHER_THRESHOLD * 100}%):`)
  for (const [p, s] of Object.entries(publishers).sort((a, b) => b[1].rows - a[1].rows)) {
    console.log(`   ${p.padEnd(4)} ${s.rows.toLocaleString().padStart(11)} rows  ${(100 * s.rate).toFixed(2)}%`)
  }
  console.log(`PICAs that do NOT publish (>=${PUBLISHER_MIN_ROWS} rows): ${nonPublishers.length} -> ${nonPublishers.slice(0, 12).join(' ')}`)
  console.log(`\ndistinct NIINs written: ${written.toLocaleString()}`)
  console.log(`   carrying an AMSC:     ${withAmsc.toLocaleString()}`)

  /* --------------------------------------------------------------------------- 4. write */
  const outDir = dataPath('flis')
  mkdirSync(outDir, { recursive: true })
  const binPath = path.join(outDir, 'amsc-index.bin')
  const metaPath = path.join(outDir, 'amsc-index.meta.json')
  writeFileSync(binPath, out.subarray(0, written * RECORD_BYTES))
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        format: 'amsc-index.bin/1',
        recordBytes: RECORD_BYTES,
        records: written,
        layout:
          'uint32BE niin, uint8 amc, uint8 amsc, uint8 aac, uint8 reserved, uint16BE picaIdx ' +
          '(1-based into picaDictionary; 0 = absent). Records are sorted ascending by niin.',
        picaDictionary: picaList,
        publishers,
        provenance: {
          derivedFrom: [{ file: 'MOE_RULE.zip::V_MOE_RULE.CSV', rows: total }],
          sourceDir: SOURCE_DIR,
          rowsWithWellFormedNiin: scratch.count,
          rowsDroppedMalformedNiin: skippedNiin,
          distinctNiins: written,
          niinsWithAmsc: withAmsc,
          publisherThreshold: PUBLISHER_THRESHOLD,
          publisherMinRows: PUBLISHER_MIN_ROWS,
          scope: 'every NIIN published in the MOE Rule file, not only those seen in our captured DIBBS days',
        },
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`\nwrote ${binPath} (${((written * RECORD_BYTES) / 1e6).toFixed(1)} MB)`)
  console.log(`distinct PICAs: ${picaList.length}`)
  console.log(`wrote ${metaPath}`)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
