import { createRequire } from 'module';
const require = createRequire('D:/fitnessassistant-playwright-e2e/package.json');
export const { chromium } = require('playwright');
export const BASE = 'http://127.0.0.1:45173';
export const SHOTS = 'D:/admin-fr/docs/admin-redesign/review/b11/shots';
export async function newCtx(browser, w = 1440, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  return ctx;
}
export async function uiLogin(page, email, password) {
  await page.goto(BASE + '/login');
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 20000 });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.locator('button[type="submit"]').first().click()]);
}
