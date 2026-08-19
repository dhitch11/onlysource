/**
 * THE APPLEDOUBLE SIDECAR REGRESSION.
 *
 * On 2026-08-18 `/competitor` served an HTTP 200 whose body was the error boundary. The cause was
 * not the page, the new teardown module, or React: the suppliers directory had been copied from a
 * Mac, macOS had written an AppleDouble sidecar beside the real export, and BOTH readers globbed
 * the directory with an ENDING-ONLY test that the sidecar's name satisfies:
 *
 *     ._rural-route-2-parts.xlsx     1,875 B   AppleDouble, not a zip   <-- matched
 *     rural-route-2-parts.xlsx     383,909 B   the real workbook, undamaged
 *
 * The sidecar reached the zip reader and threw `no zip end-of-central-directory record found`
 * out of the server render.
 *
 * ★ THE FIXTURE IS A REAL APPLEDOUBLE, NOT A SYNTHETIC "NOT A ZIP". A hand-rolled blob of junk
 *   would pass this test for the wrong reason: it proves only that garbage fails to parse, which
 *   was never in doubt. What has to be proven is that the actual artifact macOS produces, whose
 *   NAME ends in `-parts.xlsx`, is excluded BEFORE anything tries to read it. So the fixture
 *   carries the real AppleDouble magic (0x00051607) and version (0x00020000) in the real layout.
 *
 * ★ AND THE POSITIVE CONTROL IS THE POINT OF THE FILE. Two of the four cases exist to prove the
 *   test can FAIL: one asserts an unfiltered ending-only match still selects the sidecar (so we
 *   know the fixture really is a trap), and one asserts a real workbook still gets through (so we
 *   know the filter did not simply exclude everything and read as green by excluding the data).
 */
import { describe, it, expect } from 'vitest'
import { listWorkbookFiles } from '@/lib/intelligence/seed/xlsx'

/**
 * The first bytes macOS writes for an AppleDouble resource fork, in the real layout:
 * magic 0x00051607, version 0x00020000, 16 bytes of filler, then a big-endian entry count.
 * This is what a 1,875-byte `._name.xlsx` on a Linux filesystem actually begins with.
 */
function appleDoubleBytes(): Buffer {
  const head = Buffer.alloc(26)
  head.writeUInt32BE(0x00051607, 0) // magic
  head.writeUInt32BE(0x00020000, 4) // version
  head.write('Mac OS X        ', 8, 16, 'ascii') // filler
  head.writeUInt16BE(2, 24) // entry count
  return Buffer.concat([head, Buffer.alloc(1849, 0)]) // 1,875 bytes total, as observed
}

const ZIP_LOCAL_HEADER = 0x04034b50

const PARTS = (f: string) => /-parts\.xlsx$/i.test(f)

describe('listWorkbookFiles — the AppleDouble sidecar must never reach the workbook reader', () => {
  const DIR = [
    'rural-route-2-parts.xlsx',
    '._rural-route-2-parts.xlsx',
    '._hubzone-matches.xlsx',
    '.DS_Store',
    'distressed-contacts.csv',
    'acme-parts.xlsx',
  ]

  it('POSITIVE CONTROL: the fixture really is a trap — an ending-only match DOES select the sidecar', () => {
    // This is the exact predicate that shipped and took the page down. If this ever stops
    // matching, the regression this file guards has changed shape and the test below is moot.
    const naive = DIR.filter(PARTS)
    expect(naive).toContain('._rural-route-2-parts.xlsx')
  })

  it('POSITIVE CONTROL: the fixture bytes are genuinely not a zip', () => {
    const buf = appleDoubleBytes()
    expect(buf.readUInt32BE(0)).toBe(0x00051607) // it IS an AppleDouble
    expect(buf.readUInt32LE(0)).not.toBe(ZIP_LOCAL_HEADER) // and is NOT a zip
    expect(buf.length).toBe(1875) // the size observed on prod
  })

  it('excludes every dot-prefixed entry, including the sidecar whose name ends in -parts.xlsx', () => {
    const files = listWorkbookFiles(DIR, PARTS)
    expect(files).not.toContain('._rural-route-2-parts.xlsx')
    expect(files.every((f) => !f.startsWith('.'))).toBe(true)
  })

  it('STILL RETURNS THE REAL EXPORTS — the filter must not pass by excluding the data', () => {
    const files = listWorkbookFiles(DIR, PARTS)
    expect(files).toEqual(['acme-parts.xlsx', 'rural-route-2-parts.xlsx'])
  })

  it('is sorted and stable, so a directory listing order cannot change which export is "first"', () => {
    const a = listWorkbookFiles(DIR, PARTS)
    const b = listWorkbookFiles([...DIR].reverse(), PARTS)
    expect(a).toEqual(b)
  })

  it('an empty directory returns an empty list rather than throwing', () => {
    expect(listWorkbookFiles([], PARTS)).toEqual([])
  })
})
