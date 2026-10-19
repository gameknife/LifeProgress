import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await expect(page.locator("#settings")).toBeVisible();
  await page.locator("#birth-date").fill("1995-05-18");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("#settings")).not.toBeVisible();
  await expect(page.locator("#remaining")).toHaveText(/\d+w left/);
}
async function weekPoint(page: Page, index: number) {
  const rect = await page.locator("#weeks").boundingBox();
  if (!rect) throw new Error("No canvas");
  const horizontal = await page.locator("#weeks").getAttribute("aria-label").then(label => label?.startsWith("52 行"));
  const columns = horizontal ? 90 : 52, rows = horizontal ? 52 : 90;
  const spacing = Math.min((rect.width - 24) / columns, (rect.height - 24) / rows);
  return { x: rect.x + (rect.width - spacing * columns) / 2 + ((horizontal ? Math.floor(index / 52) : index % 52) + .5) * spacing,
    y: rect.y + (rect.height - spacing * rows) / 2 + ((horizontal ? index % 52 : Math.floor(index / 52)) + .5) * spacing };
}
async function clickWeek(page: Page, index: number) {
  const point = await weekPoint(page, index);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#editor")).toBeVisible();
}
test("first run settings, milestone editing, persistence and deletion", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await setup(page);
  await clickWeek(page, 52 * 22 + 12);
  await page.locator("#mark-title").fill("大学毕业");
  await page.locator("#mark-details").fill("珍藏一段旅程\n你好，未来。");
  await page.getByRole("button", { name: "天际蓝", exact: true }).click();
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
test("Escape saves future wish and restores silent mode", async ({ page }) => {
  await setup(page);
  await clickWeek(page, 4679);
  await expect(page.locator("#mark-kind")).toHaveValue("wish");
  await page.locator("#mark-title").fill("直到最后一周，也要保持好奇");
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/interactive/);
  await expect(page.locator("#editor")).not.toBeVisible();
  await page.getByRole("button", { name: "编辑预览", exact: true }).click();
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
  await expect(page.locator("#editor-error")).toContainText("disk full");
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
  await expect(page.locator("#tooltip")).toContainText("<img src=x onerror=alert(1)>");
  await expect(page.locator("#tooltip img")).toHaveCount(0);
});

test("horizontal default, layout persistence and fully transparent silent panel", async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 640 });
  await setup(page);
  await expect(page.locator("#weeks")).toHaveAttribute("aria-label", /^52 行、90 列/);
  await clickWeek(page, 1631);
  await page.locator("#mark-title").fill("两种布局中的同一周");
  await page.getByRole("button", { name: "保存标记", exact: true }).click();
  await page.locator("#settings-button").click();
  await expect(page.locator("#centered")).toBeChecked();
  await page.locator("#orientation").selectOption("vertical");
  await page.locator("#centered").uncheck();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.setViewportSize({ width: 520, height: 920 });
  await page.reload();
  await expect(page.locator("#weeks")).toHaveAttribute("aria-label", /^90 行、52 列/);
  await clickWeek(page, 1631);
  await expect(page.locator("#mark-title")).toHaveValue("两种布局中的同一周");
  await page.keyboard.press("Escape");
  for (const selector of ["html", "body", ".app-panel"]) {
    await expect(page.locator(selector)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  await page.locator("#preview-wake").click();
  await expect(page.locator(".app-panel")).toHaveCSS("background-color", "rgba(8, 8, 8, 0.98)");
  await page.locator("#settings-button").click();
  await expect(page.locator("#orientation")).toHaveValue("vertical");
  await expect(page.locator("#centered")).not.toBeChecked();
});

test("mode changes keep canvas geometry and display scale persists", async ({ page }) => {
  await page.setViewportSize({ width: 1150, height: 800 });
  await setup(page);
  const editingBounds = await page.locator("#weeks").boundingBox();
  await page.locator("#done-button").click();
  await expect(page.locator("body")).not.toHaveClass(/interactive/);
  expect(await page.locator("#weeks").boundingBox()).toEqual(editingBounds);
  await page.locator("#preview-wake").click();
  expect(await page.locator("#weeks").boundingBox()).toEqual(editingBounds);
  await page.locator("#settings-button").click();
  await expect(page.locator("#display-scale")).toHaveValue("medium");
  await page.locator("#display-scale").selectOption("large");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.reload();
  await page.locator("#settings-button").click();
  await expect(page.locator("#display-scale")).toHaveValue("large");
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
  await expect(page.locator("#editor-error")).toContainText("请填写标题");
  await expect(page.locator("body")).toHaveClass(/interactive/);
  await page.reload();
  await clickWeek(page, 0);
  await expect(page.locator("#mark-title")).toHaveValue("第一周");
});

test("failed settings save retains inputs and Escape can retry", async ({ page }) => {
  await setup(page);
  await page.locator("#settings-button").click();
  await page.locator("#orientation").selectOption("vertical");
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      Storage.prototype.setItem = setItem;
      throw new Error("disk full");
    };
  });
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-error")).toContainText("disk full");
  await expect(page.locator("#orientation")).toHaveValue("vertical");
  await expect(page.locator("#weeks")).toHaveAttribute("aria-label", /^52 行、90 列/);
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/interactive/);
  await page.reload();
  await expect(page.locator("#weeks")).toHaveAttribute("aria-label", /^90 行、52 列/);
});

test("breathing setting persists and respects reduced motion", async ({ page }) => {
  await setup(page);
  const glow = page.locator("#current-glow");
  await expect(glow).toBeVisible();
  await expect(glow).toHaveCSS("animation-name", "breathe");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(glow).toHaveCSS("animation-name", "none");
  await page.locator("#settings-button").click();
  await page.locator("#breathing").uncheck();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.reload();
  await expect(glow).toBeHidden();
});
