/** H10 probe: what columns does the Procurement sheet actually carry? Read-only. */
import { readWorkbookSheets, distinctWorkbookPaths } from '@/lib/intelligence/seed/xlsx'
import { resolveDataRoot } from '@/lib/data-root'
import { readdirSync } from 'node:fs'
import path from 'node:path'

const root = resolveDataRoot()
console.log('DATA ROOT:', JSON.stringify(root))
const dir = path.join(root.root, 'nsn-now')
const { files } = distinctWorkbookPaths(
  readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~')).map((f) => path.join(dir, f)).sort(),
)
console.log('FILES:', files.length)
const headerSets = new Map<string, string[]>()
for (const f of files) {
  const wb = readWorkbookSheets(f)
  for (const [name, sheet] of wb.sheets) {
    const cols = Object.keys(sheet.rows[0] ?? {})
    const key = name + '||' + cols.join('|')
    if (!headerSets.has(key)) { headerSets.set(key, cols); console.log('\nSHEET', name, 'from', path.basename(f), 'rows', sheet.rows.length); console.log('  COLS:', JSON.stringify(cols)) }
  }
}
