import { expect, test } from '@playwright/test'

test('Series A report prints as exactly one A4 page', async ({ page }) => {
  await page.goto('./')
  await page
    .getByRole('navigation', { name: 'Workspace screens' })
    .getByRole('button', { name: 'Report' })
    .click()
  await expect(page.getByRole('heading', { level: 2, name: 'Report' })).toBeVisible()

  await page.emulateMedia({ media: 'print' })
  const pdf = await page.pdf({ format: 'A4' })
  const pages = pdf.toString('binary').match(/\/Type\s*\/Page(?!s)/g) ?? []
  expect(pages).toHaveLength(1)
})
