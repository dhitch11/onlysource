import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 320, height: 720 } })
const p = await ctx.newPage()
await p.goto('http://localhost:3313/enter', { waitUntil: 'networkidle' })
await p.fill('input[name="password"]', 't6localverify')
await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/enter')), p.click('button[type="submit"]')])
await p.goto('http://localhost:3313/sales', { waitUntil: 'networkidle' })
const over = await p.evaluate(() => {
  const vw = document.documentElement.clientWidth
  const out = []
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.right > vw + 1) {
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').toString().slice(0, 60),
        right: Math.round(r.right), width: Math.round(r.width), vw,
      })
    }
  }
  return out.slice(0, 12)
})
console.log('viewport 320. elements extending past the viewport:')
console.log(JSON.stringify(over, null, 1))
await b.close()
