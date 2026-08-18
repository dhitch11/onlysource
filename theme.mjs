import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto('http://localhost:3313/enter', { waitUntil: 'networkidle' })
await p.fill('input[name="password"]', 't6localverify')
await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/enter')), p.click('button[type="submit"]')])
await p.goto('http://localhost:3313/sales', { waitUntil: 'networkidle' })
const r = await p.evaluate(() => {
  const cs = getComputedStyle(document.documentElement)
  const body = getComputedStyle(document.body)
  const pipe = document.querySelector('[aria-label="Pipeline"]')
  return {
    dataTheme: document.documentElement.getAttribute('data-theme'),
    token_bg: cs.getPropertyValue('--bg').trim(),
    token_sp3: cs.getPropertyValue('--sp-3').trim(),
    token_panel: cs.getPropertyValue('--panel').trim(),
    bodyBackground: body.backgroundColor,
    bodyColor: body.color,
    pipeGap: pipe ? getComputedStyle(pipe).gap : null,
    stylesheets: [...document.styleSheets].map(s => s.href || 'inline').slice(0, 8),
  }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
