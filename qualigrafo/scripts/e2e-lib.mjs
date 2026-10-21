// Shared helpers for the browser suites. They sign in through the real login form with the test-fixture accounts
// loaded by `npm run fixtures:load` in server/.
export const PASSWORD = process.env.FIXTURE_PASSWORD ?? 'Demo@12345'
export const ACCOUNTS = {
  Consultant: 'consultant@qualigrafo.test',
  Contractor: 'contractor@qualigrafo.test',
  'Owner / QA': 'qa@qualigrafo.test',
  Vendor: 'vendor@qualigrafo.test',
}

// Expected business-rule rejections (HTTP 4xx) are logged by Chrome as console errors; they are not app errors.
export const isNoise = (t) => /Failed to load resource: the server responded with a status of 4\d\d/.test(t)
export const vis = (loc, timeout = 5000) => loc.waitFor({ state: 'visible', timeout }).then(() => true, () => false)

const signedIn = new WeakMap()

export async function signIn(page, email, password = PASSWORD) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

/** Sign in as one of the fixture accounts and wait for the app shell. */
export async function loginAs(page, who) {
  await signIn(page, ACCOUNTS[who])
  await page.locator('.side').waitFor()
  signedIn.set(page, who)
}

/** Switch user: sign out, sign in as `who`, return to the same route. No-op when already signed in as `who`. */
export async function switchRole(page, who) {
  if (signedIn.get(page) === who) return
  const back = new URL(page.url()).hash
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByRole('heading', { name: 'Sign in' }).waitFor()
  await loginAs(page, who)
  if (back && back !== '#/') {
    await page.evaluate((h) => { window.location.hash = h }, back)
    await page.waitForTimeout(400)
  }
}

export const forget = (page) => signedIn.delete(page)

/** Upload a small PDF through the document drawer's uploader and wait until it shows as the current source. */
export async function attach(page, docId, name) {
  await page.setInputFiles(`input[aria-label="Source file for ${docId}"]`, { name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4 ${name} ${Date.now()}`) })
  await page.getByRole('button', { name: /^Upload (to|as draft) R\d+$/ }).click()
  await page.locator('.drawer .filecard', { hasText: name }).first().waitFor({ timeout: 8000 })
}
