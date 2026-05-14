import { expect, test } from '@playwright/test'

test('exposes explainers, percent controls, per-party presets, and report tables', async ({
  page,
}) => {
  await page.goto('./')
  const navigation = page.getByRole('navigation', { name: 'Workspace screens' })

  await page.getByRole('button', { name: 'Explain this' }).click()
  await expect(
    page.getByRole('heading', { name: 'Preferences, participation, and caps' }),
  ).toBeVisible()

  await page.getByLabel('Load example deck').selectOption('series-b-stacked-down-round')
  await page.getByLabel('Series A shares').fill('3000000')
  await page.getByLabel('Series A shares').press('Tab')
  await expect(page.getByLabel('Series A original issue price')).toHaveValue('1.3333')
  await page.getByLabel('Series A original issue price').fill('2')
  await page.getByLabel('Series A original issue price').press('Tab')
  await expect(page.getByLabel('Series A invested')).toHaveValue('6000000')

  await navigation.locator('[data-screen="round"]').click()
  await page.getByLabel('Post-round pool target (%)').fill('20')
  await page.getByLabel('Post-round pool target (%)').press('Tab')
  await expect(page.getByLabel('Post-round pool target slider')).toHaveValue('20')

  await navigation.locator('[data-screen="beliefs"]').click()
  await page.getByLabel('Use the same beliefs for both parties').uncheck()
  await page.getByLabel('Founder failure probability (%)').fill('40')
  await page.getByLabel('Founder failure probability (%)').press('Tab')
  await expect(page.getByLabel('Founder failure probability (%)')).toHaveValue('40')
  const investor = page.locator('article.belief-card').filter({
    has: page.getByRole('heading', { name: 'Investor beliefs' }),
  })
  await investor.getByRole('button', { name: 'Seed' }).click()
  await expect(page.getByLabel('Investor P50 if not zero')).toHaveValue('40000000')
  await expect(page.getByLabel('Founder failure probability (%)')).toHaveValue('40')

  await navigation.locator('[data-screen="report"]').click()
  await page.getByRole('button', { name: 'View as table' }).first().click()
  await expect(page.getByRole('columnheader', { name: 'Exit' })).toBeVisible()
})
