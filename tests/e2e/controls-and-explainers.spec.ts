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

  await navigation.getByRole('button', { name: /^Round\b/ }).click()
  await page.getByLabel('Post-round pool target (%)').fill('20')
  await page.getByLabel('Post-round pool target (%)').press('Tab')
  await expect(page.getByLabel('Post-round pool target slider')).toHaveValue('20')

  await navigation.getByRole('button', { name: 'Beliefs' }).click()
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

  await navigation.getByRole('button', { name: 'Report' }).click()
  await page.getByRole('button', { name: 'View as table' }).first().click()
  await expect(page.getByRole('columnheader', { name: 'Exit' })).toBeVisible()
})
