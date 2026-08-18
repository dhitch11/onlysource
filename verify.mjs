import { chromium } from 'playwright'
const OUT = '/private/tmp/claude-501/-Users-user/b3a32cf7-bec4-453c-86ba-29ac3802b07e/scratchpad'
const b = await chromium.launch()
const errors = []
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
p.on('pageerror', e => errors.push('pageerror: ' + e.message))

await p.goto('http://localhost:3313/enter', { waitUntil: 'networkidle' })
await p.fill('input[name="password"]', 't6localverify')
await Promise.all([
  p.waitForURL(u => !u.pathname.startsWith('/enter'), { timeout: 15000 }),
  p.click('button[type="submit"]'),
])
console.log('authenticated, at:', p.url())

for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390'], [320, 720, '320']]) {
  await p.setViewportSize({ width: w, height: h })
  await p.goto('http://localhost:3313/sales', { waitUntil: 'networkidle' })
  const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  console.log(`\n=== ${tag}px === page horizontal overflow: ${o}px`)
  if (tag === '1440') {
    console.log('RENDERED TEXT:\n' + (await p.evaluate(() => document.body.innerText)).slice(0, 1200))
    // Does the pipeline scroll INSIDE its own box rather than the page?
    const inner = await p.evaluate(() => {
      const el = document.querySelector('[aria-label="Pipeline"]')
      return el ? { scrollW: el.scrollWidth, clientW: el.clientWidth, scrolls: el.scrollWidth > el.clientWidth } : null
    })
    console.log('pipeline container:', JSON.stringify(inner))
  }
  await p.screenshot({ path: `${OUT}/sales-${tag}.png`, fullPage: true })
}
console.log('\nconsole errors:', errors.length ? errors : 'NONE')
await b.close()
