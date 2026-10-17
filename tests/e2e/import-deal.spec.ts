import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

test('imports a deal file and makes it available to the workspace', async ({ page }) => {
  await page.goto('./')
  await page.getByLabel('Import deal file').setInputFiles(resolve('examples/seed-with-safes.json'))

  await expect(page.getByRole('status')).toHaveText('Deal file imported.')
  await page
    .getByRole('navigation', { name: 'Workspace screens' })
    .locator('[data-screen="round"]')
    .click()
  await expect(page.getByRole('heading', { level: 2, name: 'Round' })).toBeVisible()
  await expect(page.getByLabel('SAFE 1 amount')).toHaveValue('500000')
})

test('exports the selected exit and two exact comparison packages', async ({ page }) => {
  await page.goto('./')
  const navigation = page.getByRole('navigation', { name: 'Workspace screens' })
  await navigation.locator('[data-screen="waterfall"]').click()
  await page.getByLabel('Exit value', { exact: true }).fill('3000000')
  await page.getByLabel('Exit value', { exact: true }).press('Tab')
  await navigation.locator('[data-screen="frontier"]').click()
  await page.getByRole('button', { name: 'View as table' }).click()
  await page.locator('tbody').getByRole('button', { name: 'Pin', exact: true }).first().click()
  await page.locator('tbody').getByRole('button', { name: 'Pin', exact: true }).first().click()
  await navigation.locator('[data-screen="report"]').click()
  await expect(page.getByText('Frontier evidence is computing.', { exact: false })).toHaveCount(0)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export deal JSON' }).click()
  const download = await pending
  await navigation.locator('[data-screen="cap-table"]').click()
  await page.getByLabel('Load example deck').selectOption('seed-with-safes')
  await page.getByLabel('Import deal file').setInputFiles((await download.path())!)
  await navigation.locator('[data-screen="waterfall"]').click()
  await expect(page.getByLabel('Exit value', { exact: true })).toHaveValue('3000000')
  await navigation.locator('[data-screen="frontier"]').click()
  await page.getByRole('button', { name: 'View as table' }).click()
  await expect(page.getByRole('button', { name: 'Unpin', exact: true })).toHaveCount(2)
})
test('pending frontier keeps controls responsive and cancellation allows a fresh run', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      override postMessage(...args: unknown[]) {
        setTimeout(() => Reflect.apply(NativeWorker.prototype.postMessage, this, args), 1500)
      }
    }
  })
  await page.goto('./')
  const navigation = page.getByRole('navigation', { name: 'Workspace screens' })
  await navigation.locator('[data-screen="frontier"]').click()
  await expect(page.getByLabel('Pre-money steps')).toBeVisible()
  await expect(page.locator('tbody').getByRole('button', { name: 'Pin', exact: true })).toHaveCount(
    0,
  )
  await page.getByRole('button', { name: 'Cancel computation' }).click()
  await expect(page.getByText('Frontier computation cancelled.')).toBeVisible()
  await page.getByRole('button', { name: 'Retry computation' }).click()
  await page.getByLabel('Pre-money steps').fill('1')
  await page.getByLabel('Pre-money steps').press('Tab')
  await navigation.locator('[data-screen="round"]').click()
  await navigation.locator('[data-screen="frontier"]').click()
  await expect(page.getByRole('button', { name: 'View as table' })).toBeVisible()
  await expect(page.getByLabel('Pre-money steps')).toHaveValue('1')
})
