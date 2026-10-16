import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage()
await p.goto('http://localhost:8081/#/p/PRJ-026/' + (process.argv[2] ?? 'overview'))
await p.waitForTimeout(300)
const r = await p.evaluate(() => {
  const out = []
  document.querySelectorAll('body *').forEach((e) => {
    const b = e.getBoundingClientRect()
    if (b.right > 392 && b.width > 0) out.push(`${e.tagName}.${(e.className || '').toString().slice(0, 30)} right=${Math.round(b.right)} w=${Math.round(b.width)}`)
  })
  return out.slice(0, 15)
})
console.log(r.join('\n'))
await b.close()
