import { chromium } from 'playwright-core'
const B = 'http://localhost:8081/'
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const p = await (await b.newContext({ viewport: { width: 1920, height: 1000 } })).newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
await p.goto(B + '#/'); await p.evaluate(() => localStorage.clear()); await p.reload()
await p.selectOption('select[aria-label="Preview role"]', 'Owner / QA')
const S = (n) => p.screenshot({ path: `e2e-out/v4-${n}.png` })
await p.waitForTimeout(300); await S('portfolio')
await p.goto(B + '#/work'); await p.waitForTimeout(200); await S('work')
await p.goto(B + '#/watch'); await p.waitForTimeout(200); await S('watch')
await p.goto(B + '#/p/PRJ-026/overview'); await p.waitForTimeout(300); await S('overview')
for (const n of ['schedule', 'team', 'templates', 'audit']) { await p.goto(B + '#/p/PRJ-026/' + n); await p.waitForTimeout(250); await S(n) }
await p.keyboard.press('Control+k'); await p.keyboard.type('traceab'); await p.waitForTimeout(250); await S('palette'); await p.keyboard.press('Escape')
await p.getByRole('button', { name: /Notifications/ }).click(); await p.waitForTimeout(200); await S('bell')
console.log('errors:', errs.length, errs.slice(0, 3))
await b.close()
