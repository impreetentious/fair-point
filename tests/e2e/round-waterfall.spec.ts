import { expect, test } from '@playwright/test'

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
