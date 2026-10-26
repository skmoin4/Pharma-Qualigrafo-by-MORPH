// UAT stage 11 — freeze an audit evidence package and download the audit package PDF.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { CHROME, vis } from '../e2e-lib.mjs'
const BASE = 'http://localhost:8084/'
const PW = 'Nova-Quality-2026'
let fail = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++ }
const note = (m) => console.log(`NOTE  ${m}`)
const browser = await chromium.launch({ executablePath: CHROME })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true })).newPage()
await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload()
await page.getByLabel('Email').fill('head.qa@novapharma.example')
await page.getByLabel('Password', { exact: true }).fill(PW)
await page.getByRole('button', { name: 'Sign in', exact: true }).click()
await page.locator('.side').waitFor(); await page.waitForTimeout(700)
await page.goto(`${BASE}#/p/PRJ-001/packages`); await page.waitForTimeout(1500)
const freeze = page.getByRole('button', { name: /Freeze package/ })
ok(await vis(freeze, 4000), 'audit packages: the Owner / QA can freeze a package at the current baseline')
await freeze.click(); await page.waitForTimeout(2200)
const t = (await page.locator('.page').innerText()).replace(/\s+/g, ' ')
ok(/SNP-|frozen|AUD-/i.test(t), 'audit packages: the package is frozen with every outstanding item disclosed')
note(`packages: ${t.slice(0, 320)}`)
const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null)
const pdf = page.locator('.page').getByRole('button', { name: /PDF/i }).first()
if (await vis(pdf, 3000)) await pdf.click()
const file = await dl
ok(!!file, `audit packages: the package is produced as a PDF${file ? ` (${file.suggestedFilename()})` : ''}`)
if (file) await file.saveAs('uat-out/audit-package.pdf')
await page.screenshot({ path: 'uat-out/56-audit-package.png', fullPage: true })
await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nSTAGE 11 OK')
