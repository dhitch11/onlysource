/**
 * A zip member reader that works on a TRUNCATED archive and says that it was truncated.
 *
 * WHY NOT `unzip`, AND WHY THIS IS NOT OVER-ENGINEERING
 *
 * A standard zip reader locates members through the central directory at the end of the
 * file. If the download died early, there is no central directory, and every standard tool
 * refuses the whole archive: `unzip` reports "End-of-central-directory signature not found"
 * and yields nothing, even though the members at the front of the file are perfectly intact.
 *
 * That is not hypothetical here. The archived `ca260811.zip` is 56,826,248 bytes with 217
 * local file headers, ZERO central directory records and ZERO end-of-central-directory
 * record: the research session's download stopped at roughly 7 percent of the real package.
 * Streaming the local headers recovered 216 of 217 complete PDFs, and those PDFs are what
 * confirmed `bq[50]` as delivery days ADO against primary source.
 *
 * So this reader walks local file headers forward and inflates each member independently.
 * It reports `truncated` and `centralDirectoryPresent` so a caller can never mistake a
 * partial archive for a whole one. Recovering what is readable is right; reporting it as
 * complete would be a fabricated measurement.
 */

import { inflateRawSync } from 'node:zlib'

const LOCAL_HEADER_SIG = 0x04034b50
const CENTRAL_DIR_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

export type ZipMember = {
  name: string
  data: Buffer
  compressionMethod: number
  /** False when this member's compressed stream was cut off by a truncated download. */
  complete: boolean
}

export type ZipReadResult = {
  members: ZipMember[]
  localHeaderCount: number
  centralDirectoryPresent: boolean
  /** True when the archive lacks its central directory, meaning the download was cut short. */
  truncated: boolean
  /** Members whose deflate stream ended prematurely. Named, never silently dropped. */
  incompleteMembers: string[]
}

/**
 * Read every member reachable by walking local file headers.
 *
 * Handles the streaming form these files use, where the local header's size fields are zero
 * and the real sizes live in a data descriptor after the compressed data (general purpose
 * bit 3). That form makes the compressed length unknowable in advance, so each member is
 * inflated until the deflate stream reports its own end, which is authoritative.
 */
export function readZipMembers(buffer: Buffer): ZipReadResult {
  const members: ZipMember[] = []
  const incompleteMembers: string[] = []
  let localHeaderCount = 0
  let centralDirectoryPresent = false

  for (let i = 0; i + 4 <= buffer.length; ) {
    const sig = buffer.readUInt32LE(i)

    if (sig === CENTRAL_DIR_SIG || sig === EOCD_SIG) {
      centralDirectoryPresent = true
      break
    }
    if (sig !== LOCAL_HEADER_SIG) {
      const next = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), i + 1)
      if (next < 0) break
      i = next
      continue
    }
    if (i + 30 > buffer.length) break

    localHeaderCount += 1
    const compressionMethod = buffer.readUInt16LE(i + 8)
    const nameLength = buffer.readUInt16LE(i + 26)
    const extraLength = buffer.readUInt16LE(i + 28)
    const nameStart = i + 30
    const name = buffer.toString('utf8', nameStart, nameStart + nameLength)
    const bodyStart = nameStart + nameLength + extraLength
    if (bodyStart >= buffer.length) break

    const body = buffer.subarray(bodyStart)
    if (compressionMethod === 0) {
      // Stored. Without the central directory the length is unknown, so stop rather than
      // guess at where this member ends.
      members.push({ name, data: Buffer.alloc(0), compressionMethod, complete: false })
      incompleteMembers.push(name)
      break
    }

    try {
      const data = inflateRawSync(body)
      members.push({ name, data, compressionMethod, complete: true })
    } catch {
      // A member cut off mid-deflate. Recorded by name, never silently skipped.
      members.push({ name, data: Buffer.alloc(0), compressionMethod, complete: false })
      incompleteMembers.push(name)
    }

    // Advance past this header; the next local header is found by scan, because the
    // compressed length is not stated in the streaming form.
    const next = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), bodyStart)
    if (next < 0) {
      const cd = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), bodyStart)
      if (cd >= 0) centralDirectoryPresent = true
      break
    }
    i = next
  }

  return {
    members,
    localHeaderCount,
    centralDirectoryPresent,
    truncated: !centralDirectoryPresent,
    incompleteMembers,
  }
}

/** Read one named member. Returns null rather than throwing when it is absent or cut off. */
export function readZipMember(buffer: Buffer, name: string): Buffer | null {
  const result = readZipMembers(buffer)
  const member = result.members.find((m) => m.name === name && m.complete)
  return member ? member.data : null
}
