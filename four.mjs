import { chromium } from 'playwright'
const OUT = '/private/tmp/claude-501/-Users-user/b3a32cf7-bec4-453c-86ba-29ac3802b07e/scratchpad'
const b = await chromium.launch()
const errors = []
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
const p = await ctx.newPage()
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
p.on('pageerror', e => errors.push('pageerror: ' + e.message))
await p.goto('http://localhost:3313/enter', { waitUntil: 'networkidle' })
await p.fill('input[name="password"]', 't6localverify')
await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/enter')), p.click('button[type="submit"]')])
for (const [w, h] of [[1440,900],[768,900],[390,844],[320,720]]) {
  await p.setViewportSize({ width: w, height: h })
  await p.goto('http://localhost:3313/sales', { waitUntil: 'networkidle' })
  const m = await p.evaluate(() => {
    const heads = [...document.querySelectorAll('[class*="__colHead"]')]
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headHeights: heads.map(h => Math.round(h.getBoundingClientRect().height)),
      focusables: document.querySelectorAll('a,button,input,[tabindex]:not([tabindex="-1"])').length,
    }
  })
  const consistent = new Set(m.headHeights).size === 1
  console.log(`${w}px overflow=${m.overflow}px  colHeadHeights=${JSON.stringify(m.headHeights)} allEqual=${consistent} focusables=${m.focusables}`)
  await p.screenshot({ path: `${OUT}/final-${w}.png`, fullPage: true })
}
console.log('console errors:', errors.length ? errors : 'NONE')
await b.close()
