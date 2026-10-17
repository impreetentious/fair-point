import { expect, test } from '@playwright/test'

test('Series A report prints as exactly one A4 page', async ({ page }) => {
  await page.goto('./')
  await page
    .getByRole('navigation', { name: 'Workspace screens' })
    .locator('[data-screen="report"]')
    .click()
  await expect(page.getByRole('heading', { level: 2, name: 'Report' })).toBeVisible()

  await expect(page.getByText(/^585 packages;/)).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  const pdf = await page.pdf({ format: 'A4' })
  const pages = pdf.toString('binary').match(/\/Type\s*\/Page(?!s)/g) ?? []
  expect(pages).toHaveLength(1)
})
