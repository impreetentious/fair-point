import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test('constructs the round and updates the waterfall at a chosen exit', async ({ page }) => {
  await page.goto('./')
  const navigation = page.getByRole('navigation', { name: 'Workspace screens' })

  await navigation.locator('[data-screen="round"]').click()
  await expect(page.getByText('Price per share')).toBeVisible()

  await navigation.locator('[data-screen="waterfall"]').click()
  await page.getByLabel('Exit value').fill('30000000')
  await page.getByLabel('Exit value').press('Tab')
  await expect(page.getByText('Σ payouts = E ✓ ($30,000,000)')).toBeVisible()
})

test('prices the next-round shadow equally for equivalent valuation and direct PPS rounds', async ({
  page,
}) => {
  const deal = JSON.parse(readFileSync('examples/series-a-clean.json', 'utf8'))
  // Eight million shares at $2.50 are $20m pre-money. With $5m new money and
  // no pool increase, either pricing mode must produce the same $25m post-money.
  deal.terms.poolTargetPost = 0
  await page.goto('./')
  const importDeal = async () => {
    await page.getByLabel('Import deal file').setInputFiles({
      name: 'deal.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(deal)),
    })
    await expect(page.getByRole('status')).toHaveText('Deal file imported.')
  }
  await importDeal()
  await page
    .getByRole('navigation', { name: 'Workspace screens' })
    .locator('[data-screen="leverage"]')
    .click()
  const shadow = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'The next round’s shadow' }),
  })
  await expect(shadow.locator('dd')).toHaveCount(4)
  const valuationReadouts = await shadow.locator('dd').allTextContents()
  expect(valuationReadouts).not.toContain('Unavailable')
  const valuationBranches = await shadow.locator('tbody').innerText()
  delete deal.terms.preMoney
  deal.terms.pricedPerShare = 2.5
  await importDeal()
  await expect(shadow.locator('dd')).toHaveText(valuationReadouts)
  await expect(shadow.locator('tbody')).toHaveText(valuationBranches, { useInnerText: true })
})
