import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 320, height: 720 } })
const p = await ctx.newPage()
await p.goto('http://localhost:3313/enter', { waitUntil: 'networkidle' })
await p.fill('input[name="password"]', 't6localverify')
await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/enter')), p.click('button[type="submit"]')])
await p.goto('http://localhost:3313/sales', { waitUntil: 'networkidle' })
const out = await p.evaluate(() => {
  const page = document.querySelector('[class*="__page"]')
  const rows = []
  const walk = (el, depth) => {
    const r = el.getBoundingClientRect()
    if (r.width > 320 || el.scrollWidth > 320) {
      rows.push({ d: depth, tag: el.tagName.toLowerCase(),
        cls: (el.className||'').toString().replace(/SalesHub-module__[A-Za-z0-9]+__/g,'').slice(0,45),
        w: Math.round(r.width), scrollW: el.scrollWidth,
        text: (el.textContent||'').trim().slice(0,50) })
    }
    for (const c of el.children) walk(c, depth + 1)
  }
  walk(page, 0)
  return rows
})
console.log(JSON.stringify(out, null, 1))
await b.close()
