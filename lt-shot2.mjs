import { chromium } from 'playwright';
const OUT='/private/tmp/claude-501/-Users-user/1d3388cc-945c-45d7-acaa-03f2971ce2fa/scratchpad/';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport:{width:1440,height:900} });
await p.goto('https://www.leadtruffle.co/', {waitUntil:'networkidle', timeout:60000});
await p.waitForTimeout(2500);
await p.screenshot({ path: OUT+'lt-desk-fold.png' });
await p.evaluate(()=>window.scrollTo(0,2600)); await p.waitForTimeout(1200);
await p.screenshot({ path: OUT+'lt-desk-2.png' });
// pricing page
const p2 = await b.newPage({ viewport:{width:1440,height:900} });
await p2.goto('https://www.leadtruffle.co/pricing/', {waitUntil:'networkidle', timeout:60000});
await p2.waitForTimeout(2000);
await p2.screenshot({ path: OUT+'lt-pricing.png', fullPage:true });
const t = await p2.evaluate(()=>document.body.innerText.slice(0,4000));
console.log(t);
await b.close();
