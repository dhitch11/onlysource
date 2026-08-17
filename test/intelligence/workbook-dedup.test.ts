/**
 * A WORKBOOK PRESENT UNDER TWO FILENAMES IS ONE WORKBOOK.
 *
 * Measured defect this pins (2026-08-17): the deployed NSN-Now directory held the same
 * export bytes as BatchExport_69817.xlsx AND full_0.xlsx, so the dashboard's provenance
 * disclosure claimed 8 independent workbooks where 7 existed. Every count was right (the
 * row dedup absorbed the duplicate); the claim about the evidence base was not. The index
 * builders now list files distinct-by-content before reading them.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { distinctWorkbookPaths } from '@/lib/intelligence/seed/xlsx'

const dir = mkdtempSync(path.join(tmpdir(), 'os-dedup-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function file(name: string, bytes: string): string {
  const p = path.join(dir, name)
  writeFileSync(p, bytes)
  return p
}

describe('distinctWorkbookPaths', () => {
  it('drops a byte-identical file under a second name and reports the pairing', () => {
    const a = file('BatchExport_69817.xlsx', 'same-bytes-A')
    const b = file('full_0.xlsx', 'same-bytes-A')
    const c = file('more_0.xlsx', 'different-bytes-B')
    const out = distinctWorkbookPaths([a, b, c].sort())
    expect(out.files).toHaveLength(2)
    expect(out.files).toContain(c)
    expect(out.droppedDuplicates).toHaveLength(1)
    expect(out.droppedDuplicates[0]!.kept).not.toBe(out.droppedDuplicates[0]!.dropped)
  })

  it('keeps first-by-order, so a sorted listing is deterministic across runs', () => {
    const a = file('a1.xlsx', 'dup-bytes')
    const b = file('b2.xlsx', 'dup-bytes')
    const out = distinctWorkbookPaths([a, b])
    expect(out.files).toEqual([a])
    expect(out.droppedDuplicates).toEqual([{ kept: a, dropped: b }])
  })

  it('all-distinct input passes through unchanged (positive control)', () => {
    const a = file('x1.xlsx', 'one')
    const b = file('x2.xlsx', 'two')
    const out = distinctWorkbookPaths([a, b])
    expect(out.files).toEqual([a, b])
    expect(out.droppedDuplicates).toEqual([])
  })
})
