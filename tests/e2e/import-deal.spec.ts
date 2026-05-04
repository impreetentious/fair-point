import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

test('imports a deal file and makes it available to the workspace', async ({ page }) => {
  await page.goto('./')
  await page.getByLabel('Import deal file').setInputFiles(resolve('examples/seed-with-safes.json'))

  await expect(page.getByRole('status')).toHaveText('Deal file imported.')
  await page
    .getByRole('navigation', { name: 'Workspace screens' })
    .getByRole('button', { name: 'Round' })
    .click()
  await expect(page.getByRole('heading', { level: 2, name: 'Round' })).toBeVisible()
  await expect(page.getByLabel('SAFE 1 amount')).toHaveValue('500000')
})
