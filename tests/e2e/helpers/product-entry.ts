import { expect, type Page } from '@playwright/test'

export async function createLongform(page: Page, title: string) {
  await page.goto('./long?module=outline')
  await page.getByRole('button', {name:'新建长篇',exact:true}).click()
  await page.getByLabel('新长篇名称').fill(title)
  await page.getByRole('button',{name:'创建并进入工作台',exact:true}).click()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
}
