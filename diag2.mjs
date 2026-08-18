import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 320, height: 720 } })
const p = await ctx.newPage()
await p.goto('http://localhost:3313/enter', { waitUntil: 'networkidle' })
await p.fill('input[name="password"]', 't6localverify')
await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/enter')), p.click('button[type="submit"]')])
await p.goto('http://localhost:3313/sales', { waitUntil: 'networkidle' })
const info = await p.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return { sel, w: Math.round(r.width), scrollW: el.scrollWidth, clientW: el.clientWidth,
             overflowX: cs.overflowX, minWidth: cs.minWidth, display: cs.display }
  }
  const pipe = document.querySelector('[aria-label="Pipeline"]')
  const chain = []
  let el = pipe
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    chain.push({ tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,40),
                 w: Math.round(r.width), scrollW: el.scrollWidth, overflowX: cs.overflowX,
                 minW: cs.minWidth, display: cs.display })
    el = el.parentElement
  }
  return { doc: { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth },
           body: { scrollW: document.body.scrollWidth, clientW: document.body.clientWidth },
           chain }
})
console.log(JSON.stringify(info, null, 1))
await b.close()
