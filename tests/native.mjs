// Run against a dev app launched with LIFE_PROGRESS_DATA_DIR=.qa/native and CDP port 9229.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { calendarLayout, pointAt } from '../src/calendar.ts';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9229');
const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('localhost:1420'));
if (!page) throw new Error('Life Progress WebView not found');
await expect(page.locator('#weeks')).toHaveAttribute('tabindex', '-1');
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const windowBounds = () => process.env.LIFE_PROGRESS_QA_PROCESS_ID ? JSON.parse(execFileSync('powershell', [
  '-NoProfile', '-File', 'tests/window-bounds.ps1', '-AppProcessId', process.env.LIFE_PROGRESS_QA_PROCESS_ID,
], { encoding: 'utf8' })) : null;
let snapshot = await invoke('load_data');
assert.ok(snapshot.dataPath.replaceAll('\\', '/').includes('/.qa/native/'), 'Native QA requires an isolated data directory');
assert.equal(snapshot.interactive, false, 'Default startup must be silent');
if (!process.env.LIFE_PROGRESS_QA_ALLOW_SHORTCUT_CONFLICT) assert.equal(snapshot.warning, null, 'Global shortcut should register');
if (snapshot.loadError) {
  const broken = await readFile(snapshot.dataPath, 'utf8');
  const backup = JSON.parse(await readFile(snapshot.dataPath + '.bak', 'utf8'));
  await assert.rejects(invoke('save_data', { data: snapshot.data }));
  assert.equal(await readFile(snapshot.dataPath, 'utf8'), broken);
  await invoke('set_mode', { interactive: true });
  await page.locator('#birth-date').fill('2000-01-01');
  await page.locator('#birth-date').blur();
  await expect(page.locator('#notice')).toContainText('请先恢复数据');
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveClass(/interactive/);
  await page.getByRole('button', { name: '恢复数据', exact: true }).click();
  await expect(page.locator('#recover-button')).toBeHidden();
  snapshot = await invoke('load_data');
  assert.equal(snapshot.loadError, null);
  assert.equal(snapshot.data.birthDate, backup.birthDate);
  for (const [week, { title, details, color }] of Object.entries(backup.milestones)) {
    assert.deepEqual(snapshot.data.milestones[week], { title, details, color });
  }
  const preserved = (await readdir(dirname(snapshot.dataPath))).find(name => name.startsWith('milestones.json.corrupt-'));
  assert.ok(preserved, 'Recovery must preserve the unreadable original');
  assert.equal(await readFile(join(dirname(snapshot.dataPath), preserved), 'utf8'), broken);
  await invoke('set_mode', { interactive: false });
}
const original = await readFile(snapshot.dataPath, 'utf8').catch(() => null);
if (original && JSON.parse(original).version === 1) {
  const legacy = JSON.parse(original);
  assert.equal(snapshot.data.version, 2);
  assert.equal(snapshot.data.birthDate, legacy.birthDate);
  for (const [week, { title, details, color }] of Object.entries(legacy.milestones)) {
    assert.deepEqual(snapshot.data.milestones[week], { title, details, color });
  }
  await invoke('save_data', { data: snapshot.data });
  assert.equal(await readFile(snapshot.dataPath + '.bak', 'utf8'), original);
}
await invoke('save_data', { data: { version: 2, birthDate: null, milestones: {} } });
await page.reload();
await expect(page.locator('#remaining')).toHaveText('— / 4680 weeks');
await expect(page.locator('.app-panel')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
await expect(page.locator('#weeks')).toHaveAttribute('aria-label', /^52 行、90 列/);
assert.ok(await page.evaluate(() => innerWidth > innerHeight), 'Horizontal native window should be wider than tall');
const silentCanvasBounds = await page.locator('#weeks').boundingBox();
const silentClientSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
const silentWindowBounds = windowBounds();
await invoke('set_mode', { interactive: true });
await expect(page.locator('#birth-date')).toBeVisible();
assert.deepEqual(await page.locator('#weeks').boundingBox(), silentCanvasBounds, 'Editing must preserve canvas geometry');
assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), silentClientSize, 'Editing must preserve client size');
assert.deepEqual(windowBounds(), silentWindowBounds, 'Editing must preserve OS window bounds');
await page.locator('#birth-date').fill('1995-05-18');
await page.locator('#birth-date').blur();
await expect(page.locator('#remaining')).toHaveText(/^\d+ \/ \d+ weeks$/);

async function clickWeek(index) {
  const rect = await page.locator('#weeks').boundingBox();
  const point = pointAt(index, calendarLayout(rect.width, rect.height));
  await page.mouse.click(rect.x + point.x, rect.y + point.y);
  await expect(page.locator('#editor')).toBeVisible();
}
await clickWeek(52 * 22 + 12);
await page.locator('#mark-title').fill('大学毕业');
await page.locator('#mark-details').fill('新的篇章，从这里开始。');
await page.locator('#mark-color').evaluate(input => { input.value = '#38bdf8'; });
await page.getByRole('button', { name: '保存标记', exact: true }).click();
await expect(page.locator('#mark-count')).toHaveText('1 个标记');
await clickWeek(52 * 40 + 20);
await page.locator('#mark-title').fill('环球旅行计划');
await page.locator('#mark-details').fill('去看更大的世界。');
await page.screenshot({ path: '.qa/editor.png' });
await page.keyboard.press('Escape');
await expect(page.locator('body')).not.toHaveClass(/interactive/);
const saved = await invoke('load_data');
assert.equal(saved.interactive, false);
assert.equal(saved.data.milestones[52 * 40 + 20].title, '环球旅行计划');
const disk = JSON.parse(await readFile(saved.dataPath, 'utf8'));
assert.equal(disk.birthDate, '1995-05-18');
assert.equal(disk.milestones[52 * 22 + 12].color.toLowerCase(), '#38bdf8');
const backup = JSON.parse(await readFile(saved.dataPath + '.bak', 'utf8'));
assert.equal(backup.milestones[52 * 40 + 20], undefined, 'Escape must preserve the previous version in the backup');
assert.equal(backup.milestones[52 * 22 + 12].title, '大学毕业');
await page.screenshot({ path: '.qa/silent.png' });
// Reload the actual WebView and verify Rust-backed data is restored.
await page.reload();
await expect(page.locator('#remaining')).toHaveText(/^\d+ \/ \d+ weeks$/);
await invoke('set_mode', { interactive: true });
await clickWeek(52 * 40 + 20);
await expect(page.locator('#mark-title')).toHaveValue('环球旅行计划');
await page.getByRole('button', { name: '删除标记', exact: true }).click();
assert.equal((await invoke('load_data')).data.milestones[52 * 40 + 20], undefined);
await clickWeek(52 * 22 + 12);
await expect(page.locator('#mark-title')).toHaveValue('大学毕业');
await page.getByRole('button', { name: '保存并关闭编辑', exact: true }).click();
await page.getByRole('button', { name: '完成 esc', exact: true }).click();
await expect(page.locator('body')).not.toHaveClass(/interactive/);
assert.deepEqual(await page.locator('#weeks').boundingBox(), silentCanvasBounds);
assert.deepEqual(windowBounds(), silentWindowBounds);
console.log('Native QA passed: migration, mode geometry, silent transparency, editing, backup and JSON persistence.');
await browser.close();
