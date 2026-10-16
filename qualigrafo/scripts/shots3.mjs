import { chromium } from 'playwright-core'
const B = 'http://localhost:8081/'
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
await p.goto(B + '#/'); await p.evaluate(() => localStorage.clear()); await p.reload()
await p.selectOption('select[aria-label="Preview role"]', 'Owner / QA')
for (const n of ['risks', 'ncrs', 'vendor', 'rehearsal', 'overview']) { await p.goto(B + '#/p/PRJ-026/' + n); await p.waitForTimeout(300); await p.screenshot({ path: `e2e-out/v5-${n}.png`, fullPage: n === 'overview' }) }
await b.close()
