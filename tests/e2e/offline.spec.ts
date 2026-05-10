import { expect, test, type Page, type Request } from '@playwright/test'

const SCREENS = [
  { label: 'Cap Table', heading: 'Cap table' },
  { label: 'Round', heading: 'Round' },
  { label: 'Waterfall', heading: 'Waterfall' },
  { label: 'Beliefs', heading: 'Beliefs' },
  { label: 'Frontier', heading: 'Frontier' },
  { label: 'Report', heading: 'Report' },
] as const

async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false
    const registration = await navigator.serviceWorker.getRegistration('./')
    return (
      registration?.active?.state === 'activated' || navigator.serviceWorker.controller !== null
    )
  })
  // Give the install handler time to finish precaching before we cut the network.
  await page.waitForTimeout(750)
}

async function assertAllScreens(page: Page): Promise<void> {
  for (const screen of SCREENS) {
    await page
      .getByRole('navigation', { name: 'Workspace screens' })
      .getByRole('button', { name: new RegExp(`^${screen.label}\\b`) })
      .click()
    await expect(page.getByRole('heading', { level: 2, name: screen.heading })).toBeVisible()
  }
}

test.describe('Phase 9 offline contract', () => {
  test('service worker keeps all six screens alive with zero post-reload network hits', async ({
    page,
    context,
  }) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await waitForServiceWorker(page)
    await assertAllScreens(page)

    const failed: string[] = []
    const networkHits: string[] = []
    const onFailed = (request: Request) => {
      failed.push(`${request.failure()?.errorText ?? 'failed'}: ${request.url()}`)
    }
    const onFinished = async (request: Request) => {
      const response = await request.response()
      if (response === null) return
      // Cache-first SW should satisfy every same-origin GET after reload when offline.
      if (!response.fromServiceWorker()) networkHits.push(request.url())
    }

    await context.setOffline(true)
    page.on('requestfailed', onFailed)
    page.on('requestfinished', (request) => {
      void onFinished(request)
    })
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await assertAllScreens(page)
      // Allow in-flight response attribution to settle.
      await page.waitForTimeout(250)
    } finally {
      page.off('requestfailed', onFailed)
      await context.setOffline(false)
    }

    expect(failed, `request failures while offline:\n${failed.join('\n')}`).toEqual([])
    expect(networkHits, `non-SW network hits while offline:\n${networkHits.join('\n')}`).toEqual([])
  })
})
