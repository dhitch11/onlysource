import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
for (const [name, w, h] of [['desk',1440,900],['mob',390,844]]) {
  const p = await b.newPage({ viewport:{width:w,height:h} });
  const errs=[];
  p.on('console', m=>{ if(m.type()==='error') errs.push(m.text().slice(0,120)); });
  try{
    await p.goto('https://www.leadtruffle.co/', {waitUntil:'networkidle', timeout:60000});
    await p.waitForTimeout(2500);
    const hs = await p.evaluate(()=>({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      docH: document.documentElement.scrollHeight,
      tel: document.querySelectorAll('a[href^="tel:"]').length,
      h1: (document.querySelector('h1')||{}).innerText,
      h2count: document.querySelectorAll('h2').length,
      forms: document.querySelectorAll('form').length,
      video: document.querySelectorAll('video').length,
    }));
    console.log(name, JSON.stringify(hs), 'consoleErrors:', errs.length, errs.slice(0,3));
    await p.screenshot({ path:`/private/tmp/claude-501/-Users-user/1d3388cc-945c-45d7-acaa-03f2971ce2fa/scratchpad/lt-${name}.png`, fullPage: name==='desk' });
  }catch(e){ console.log(name,'ERR',e.message.slice(0,150)); }
  await p.close();
}
await b.close();
