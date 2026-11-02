import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

test('EvoBR opens its real Long Form workspace without product hub or startup errors', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createLongform(page, 'EvoBR Long Form browser verification')
  await expect(page.locator('.lf-current')).toContainText('EvoBR Long Form browser verification')
  await expect(page.getByRole('navigation', { name: '长篇工作台二级导航' })).toBeVisible()
  const productNavigation = page.getByRole('navigation', { name: '产品导航' })
  await expect(productNavigation.getByRole('link')).toHaveCount(2)
  await expect(productNavigation.getByRole('link', { name: 'Long Form', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('longform-workspace.png'), fullPage: true })
  await page.reload()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
  await expect(page.locator('.lf-current')).toContainText('EvoBR Long Form browser verification')
  expect(errors).toEqual([])
})
