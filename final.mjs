import { chromium } from 'playwright'
const OUT = '/private/tmp/claude-501/-Users-user/b3a32cf7-bec4-453c-86ba-29ac3802b07e/scratchpad'
const b = await chromium.launch()
for (const scheme of ['dark', 'light']) {
  const errors = []
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })
  const p = await ctx.newPage()
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  p.on('pageerror', e => errors.push('pageerror: ' + e.message))
  await p.goto('http://localhost:3313/enter', { waitUntil: 'networkidle' })
  await p.fill('input[name="password"]', 't6localverify')
  await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/enter')), p.click('button[type="submit"]')])
  for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390'], [320, 720, '320']]) {
    await p.setViewportSize({ width: w, height: h })
    await p.goto('http://localhost:3313/sales', { waitUntil: 'networkidle' })
    const m = await p.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bg: getComputedStyle(document.body).backgroundColor,
      gap: (() => { const e = document.querySelector('[aria-label="Pipeline"]'); return e ? getComputedStyle(e).gap : null })(),
      pipeClips: (() => { const e = document.querySelector('[aria-label="Pipeline"]'); return e ? e.scrollWidth > e.clientWidth : null })(),
    }))
    console.log(`${scheme} ${tag}px  overflow=${m.overflow}px  bg=${m.bg}  gap=${m.gap}  pipeScrollsInternally=${m.pipeClips}`)
    if (tag !== '320' || scheme === 'dark') await p.screenshot({ path: `${OUT}/sales-${scheme}-${tag}.png`, fullPage: true })
  }
  console.log(`${scheme}: console errors = ${errors.length ? errors.join(' | ') : 'NONE'}`)
  await ctx.close()
}
await b.close()
