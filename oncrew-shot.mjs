import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
for (const [w,h,tag] of [[1440,900,'desktop'],[390,844,'mobile']]) {
  const c = await b.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:1 });
  const p = await c.newPage();
  const errs=[];
  p.on('console', m => { if(m.type()==='error') errs.push(m.text()); });
  await p.goto('https://oncrew.ai/', { waitUntil:'networkidle', timeout:60000 });
  await p.waitForTimeout(2500);
  await p.screenshot({ path:`/private/tmp/claude-501/-Users-user/1d3388cc-945c-45d7-acaa-03f2971ce2fa/scratchpad/oncrew-${tag}.png`, fullPage:false });
  const hs = await p.evaluate(()=>document.documentElement.scrollWidth > document.documentElement.clientWidth+1);
  const tel = await p.evaluate(()=>document.querySelectorAll('a[href^="tel:"]').length);
  const telHrefs = await p.evaluate(()=>[...document.querySelectorAll('a[href^="tel:"]')].map(a=>a.getAttribute('href')));
  console.log(JSON.stringify({tag,w,hScroll:hs,telLinks:tel,telHrefs,consoleErrors:errs.slice(0,5)}));
  await c.close();
}
await b.close();
