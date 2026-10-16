import { chromium } from 'playwright-core'
const B = 'http://localhost:8081/'
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
await p.goto(B + '#/'); await p.evaluate(() => localStorage.clear())
const S = (n) => p.screenshot({ path: `e2e-out/s-${n}.png` })

await p.goto(B + '#/p/PRJ-026/documents')
await p.getByRole('button', { name: 'Cleanroom panel layout' }).first().click()
await p.waitForTimeout(200); await S('doc-drawer')
await p.keyboard.press('Escape')

await p.goto(B + '#/p/PRJ-026/requirements')
await p.getByRole('button', { name: 'Material traceability for utility piping' }).first().click()
await p.waitForTimeout(200); await S('req-drawer')
await p.keyboard.press('Escape')

await p.goto(B + '#/p/PRJ-026/sources')
await p.getByRole('button', { name: 'Revit connector' }).click()
await p.getByRole('button', { name: /Preview sample Revit update/ }).click()
await S('sources-revit')

await p.goto(B + '#/p/PRJ-026/comments')
await p.getByRole('button', { name: 'Revit connector' }).first().click()
await p.getByRole('button', { name: 'Zoom to comment' }).click()
await p.waitForTimeout(300); await S('comments-revit')

for (const n of ['setup', 'evidence', 'inspector', 'handover', 'changes', 'findings']) { await p.goto(B + '#/p/PRJ-026/' + n); await p.waitForTimeout(200); await S(n) }

const m = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage()
await m.goto(B + '#/p/PRJ-026/documents'); await m.getByRole('button', { name: 'Cleanroom panel layout' }).first().click(); await m.waitForTimeout(200)
await m.screenshot({ path: 'e2e-out/s-mobile-drawer.png' })
await b.close()
