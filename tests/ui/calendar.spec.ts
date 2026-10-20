import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('src="/src/main.ts"', 'src="/tests/ui/bootstrap.ts"') });
  });
});
async function wake(page: Page) {
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("set_mode", { interactive: true }));
}
async function setup(page: Page) {
  await page.goto("/");
  await expect(page.locator("#birth-date")).toBeVisible();
  await page.locator("#birth-date").fill("1995-05-18");
  await page.locator("#birth-date").blur();
  await expect(page.locator("#remaining")).toHaveText(/^\d+ \/ \d+ weeks$/);
}
async function weekPoint(page: Page, index: number) {
  const rect = await page.locator("#weeks").boundingBox();
  if (!rect) throw new Error("No canvas");
  const spacing = Math.min((rect.width - 24) / 90, (rect.height - 24) / 52);
  return { x: rect.x + (rect.width - spacing * 90) / 2 + (Math.floor(index / 52) + .5) * spacing,
    y: rect.y + (rect.height - spacing * 52) / 2 + (index % 52 + .5) * spacing };
}
async function clickWeek(page: Page, index: number) {
  const point = await weekPoint(page, index);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#editor")).toBeVisible();
}
test("birthday, milestone editing, persistence and deletion", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await setup(page);
  await clickWeek(page, 52 * 22 + 12);
  await page.locator("#mark-title").fill("大学毕业");
  await page.locator("#mark-details").fill("珍藏一段旅程\n你好，未来。");
  await page.locator("#mark-color").evaluate((input: HTMLInputElement) => { input.value = "#38bdf8"; });
  await page.getByRole("button", { name: "保存标记", exact: true }).click();
  await expect(page.locator("#mark-count")).toHaveText("1 个标记");
  await page.reload();
  await expect(page.locator("#mark-count")).toHaveText("1 个标记");
  await clickWeek(page, 52 * 22 + 12);
  await expect(page.locator("#mark-title")).toHaveValue("大学毕业");
  await expect(page.locator("#mark-color")).toHaveValue("#38bdf8");
  await expect(page.locator("#mark-details")).toHaveValue("珍藏一段旅程\n你好，未来。");
  await page.getByRole("button", { name: "删除标记", exact: true }).click();
  await expect(page.locator("#mark-count")).toHaveText("0 个标记");
  expect(errors).toEqual([]);
});
test("Escape saves a future mark and restores silent mode", async ({ page }) => {
  await setup(page);
  await clickWeek(page, 4679);
  await page.locator("#mark-title").fill("直到最后一周，也要保持好奇");
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/interactive/);
  await expect(page.locator("#editor")).not.toBeVisible();
  await wake(page);
  await clickWeek(page, 4679);
  await expect(page.locator("#mark-title")).toHaveValue("直到最后一周，也要保持好奇");
  const popup = await page.locator("#editor").boundingBox();
  expect(popup!.y + popup!.height).toBeLessThanOrEqual(920);
});
test("save failure keeps draft and editor available", async ({ page }) => {
  await setup(page);
  await clickWeek(page, 100);
  await page.locator("#mark-title").fill("不能丢失的输入");
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("disk full"); }; });
  await page.keyboard.press("Escape");
  await expect(page.locator("#notice")).toContainText("disk full");
  await expect(page.locator("#mark-title")).toHaveValue("不能丢失的输入");
  await expect(page.locator("body")).toHaveClass(/interactive/);
});
test("tooltip is text-safe and keyboard can open nodes", async ({ page }) => {
  await setup(page);
  await page.locator("#weeks").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.locator("#editor-heading")).toHaveText("1 岁 · 第 1 周");
  await page.locator("#mark-title").fill("<img src=x onerror=alert(1)>");
  await page.getByRole("button", { name: "保存标记", exact: true }).click();
  const point = await weekPoint(page, 52);
  await page.mouse.move(point.x, point.y);
  await expect(page.getByRole("tooltip")).toContainText("<img src=x onerror=alert(1)>");
  await expect(page.locator("img")).toHaveCount(0);
});

test("silent hover shows records without editing or focus and hides on empty weeks", async ({ page }) => {
  await setup(page);
  const counts = (await page.locator("#remaining").innerText()).match(/\d+/g)!.map(Number);
  expect(counts[0] + counts[1]).toBe(4680);
  await expect(page.locator("#remaining")).toHaveCSS("color", "rgb(115, 115, 115)");
  await clickWeek(page, 4679);
  await page.locator("#mark-title").fill("最后一周");
  await page.locator("#mark-details").fill("珍惜当下\n<em>原样显示</em>");
  await page.keyboard.press("Escape");
  const focus = await page.evaluate(() => document.activeElement?.id);
  const point = await weekPoint(page, 4679);
  await page.mouse.move(point.x, point.y);
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("最后一周\n珍惜当下\n<em>原样显示</em>");
  await expect(tooltip.locator("em")).toHaveCount(0);
  await expect(tooltip).toHaveCSS("pointer-events", "none");
  await expect(page.locator("body")).not.toHaveClass(/interactive/);
  await expect(page.locator("#editor")).not.toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(focus);
  const bounds = await tooltip.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(520);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(920);
  const empty = await weekPoint(page, 0);
  await page.mouse.move(empty.x, empty.y);
  await expect(tooltip).not.toBeVisible();
  await page.mouse.move(point.x, point.y);
  await expect(tooltip).toBeVisible();
  await wake(page);
  await expect(tooltip).not.toBeVisible();
});

test("manual resizing preserves the same mark in the horizontal grid", async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 640 });
  await setup(page);
  await expect(page.locator("#weeks")).toHaveAttribute("aria-label", /^52 行、90 列/);
  await clickWeek(page, 1631);
  await page.locator("#mark-title").fill("缩放后的同一周");
  await page.getByRole("button", { name: "保存标记", exact: true }).click();
  await page.setViewportSize({ width: 520, height: 920 });
  await page.reload();
  await expect(page.locator("#weeks")).toHaveAttribute("aria-label", /^52 行、90 列/);
  await clickWeek(page, 1631);
  await expect(page.locator("#mark-title")).toHaveValue("缩放后的同一周");
  await page.keyboard.press("Escape");
  for (const selector of ["html", "body", ".app-panel"]) {
    await expect(page.locator(selector)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  await wake(page);
  await expect(page.locator(".app-panel")).toHaveCSS("background-color", "rgba(8, 8, 8, 0.98)");
});

test("mode changes keep canvas geometry", async ({ page }) => {
  await page.setViewportSize({ width: 1150, height: 800 });
  await setup(page);
  const editingBounds = await page.locator("#weeks").boundingBox();
  await page.locator("#done-button").click();
  await expect(page.locator("body")).not.toHaveClass(/interactive/);
  expect(await page.locator("#weeks").boundingBox()).toEqual(editingBounds);
  await wake(page);
  expect(await page.locator("#weeks").boundingBox()).toEqual(editingBounds);
});

test("switching weeks saves drafts and clearing a title never deletes a mark", async ({ page }) => {
  await setup(page);
  await clickWeek(page, 0);
  await page.locator("#mark-title").fill("第一周");
  await clickWeek(page, 4679);
  await expect(page.locator("#editor-heading")).toHaveText("89 岁 · 第 52 周");
  await expect(page.locator("#mark-count")).toHaveText("1 个标记");
  await page.getByRole("button", { name: "保存并关闭编辑", exact: true }).click();
  await clickWeek(page, 0);
  await expect(page.locator("#mark-title")).toHaveValue("第一周");
  await page.locator("#mark-title").fill("");
  await page.keyboard.press("Escape");
  await expect(page.locator("#notice")).toContainText("请填写标题");
  await expect(page.locator("body")).toHaveClass(/interactive/);
  await page.reload();
  await clickWeek(page, 0);
  await expect(page.locator("#mark-title")).toHaveValue("第一周");
});

test("failed birthday save retains input and Escape can retry", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      Storage.prototype.setItem = setItem;
      throw new Error("disk full");
    };
  });
  await page.locator("#birth-date").fill("2000-02-29");
  await page.locator("#birth-date").blur();
  await expect(page.locator("#notice")).toContainText("disk full");
  await expect(page.locator("#birth-date")).toHaveValue("2000-02-29");
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/interactive/);
  await page.reload();
  await expect(page.locator("#birth-date")).toHaveValue("2000-02-29");
});

test("a failed deletion keeps the mark and editor", async ({ page }) => {
  await setup(page);
  await clickWeek(page, 0);
  await page.locator("#mark-title").fill("保留这条标记");
  await page.getByRole("button", { name: "保存标记", exact: true }).click();
  await clickWeek(page, 0);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("disk full"); }; });
  await page.getByRole("button", { name: "删除标记", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("disk full");
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#mark-count")).toHaveText("1 个标记");
  await page.reload();
  await clickWeek(page, 0);
  await expect(page.locator("#mark-title")).toHaveValue("保留这条标记");
});

test("an invalid birthday stays editable and cannot be hidden behind the editor", async ({ page }) => {
  await setup(page);
  await page.locator("#birth-date").fill("2999-01-01");
  await page.locator("#birth-date").blur();
  await expect(page.locator("#notice")).toContainText("出生日期不能晚于今天");
  const point = await weekPoint(page, 0);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#editor")).not.toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveClass(/interactive/);
  await page.reload();
  await expect(page.locator("#birth-date")).toHaveValue("1995-05-18");
});

test("the editor and save error fit the minimum window size", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 320 });
  await setup(page);
  await clickWeek(page, 4679);
  await page.locator("#mark-title").fill("小窗口也不能丢输入");
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("disk full"); }; });
  await page.keyboard.press("Escape");
  await expect(page.locator("#notice")).toContainText("disk full");
  const bounds = await page.locator("#editor").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(320);
  expect(await page.locator("#notice").evaluate(node => {
    const rect = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(rect.x + 5, rect.y + 5));
  })).toBe(true);
  await page.screenshot({ path: ".qa/minimal-small.png" });
});
