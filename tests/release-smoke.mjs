// Read-only data smoke test for a release app temporarily launched with CDP port 9229.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9229');
const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('tauri.localhost'));
assert.ok(page, 'Packaged frontend should load from the Tauri protocol');
await expect(page.locator('#weeks')).toHaveAttribute('tabindex', '-1');
const [, interactive] = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('load_data'));
assert.equal(interactive, false);
await expect(page.locator('#notice')).not.toBeVisible();
await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('set_mode', { interactive: true }));
await expect(page.locator('body')).toHaveClass(/interactive/);
await expect(page.locator('#birth-date')).toBeVisible();
await page.screenshot({ path: '.qa/release-first-run.png' });
await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('set_mode', { interactive: false }));
await expect(page.locator('body')).not.toHaveClass(/interactive/);
console.log('Release smoke passed: bundled frontend, Rust IPC, first-run UI and silent mode.');
await browser.close();
