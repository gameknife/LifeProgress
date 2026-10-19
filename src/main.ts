import "./styles.css";
import { drawCalendar, hitTest, pointAt, type Layout } from "./calendar";
import { emptyData, getProgress, localToday, validateBirthday, weekDates, weekDescription, weekStatus, TOTAL_WEEKS, WEEKS_PER_YEAR, type AppData, type Milestone } from "./model";
import { native, loadSnapshot, saveData, recoverData, changeMode, beginDrag, quitApp, subscribe } from "./bridge";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}
const canvas = element<HTMLCanvasElement>("weeks");
const editor = element<HTMLDialogElement>("editor");
const settings = element<HTMLDialogElement>("settings");
const titleInput = element<HTMLInputElement>("mark-title");
const detailsInput = element<HTMLTextAreaElement>("mark-details");
const kindInput = element<HTMLSelectElement>("mark-kind");
const colorInput = element<HTMLInputElement>("mark-color");
const birthInput = element<HTMLInputElement>("birth-date");
const breathingInput = element<HTMLInputElement>("breathing");
const orientationInput = element<HTMLSelectElement>("orientation");
const centeredInput = element<HTMLInputElement>("centered");
const displayScaleInput = element<HTMLSelectElement>("display-scale");
const tooltip = element<HTMLDivElement>("tooltip");
const glow = element<HTMLDivElement>("current-glow");
let data: AppData = emptyData();
let interactive = false;
let selected: number | null = null;
let layout: Layout;
let busy = false;
let ready = false;
let loadError: string | null = null;
let warning: string | null = null;
let toastTimer: ReturnType<typeof setTimeout>;
let keyboardWeek = 0;

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function toast(message: string): void {
  const node = element("toast");
  node.textContent = message; node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4000);
}
function updateNotice(): void {
  const notice = element("notice");
  notice.hidden = !interactive || (!loadError && !warning);
  element("notice-text").textContent = loadError ? `数据未载入：${loadError}。恢复会保留损坏原件；有备份则恢复，否则重新设置。` : warning;
  element("recover-button").hidden = !loadError;
}
function render(): void {
  layout = drawCalendar(canvas, data, interactive, selected);
  const progress = getProgress(data.birthDate);
  element("remaining").textContent = data.birthDate ? `${progress.remaining}w left` : "—w left";
  element("percent").textContent = data.birthDate ? `${progress.percent.toFixed(1)}%` : "—%";
  element("life-caption").textContent = !data.birthDate ? "Ctrl+Alt+L · 设置出生日期" :
    progress.current === null ? "90 年 · 每一周都曾属于你" : `${weekDescription(progress.current)} · ${interactive ? "编辑中" : "Ctrl+Alt+L 编辑"}`;
  element("mark-count").textContent = `${Object.keys(data.milestones).length} 个标记`;
  const dimensions = data.orientation === "horizontal" ? "52 行、90 列" : "90 行、52 列";
  canvas.setAttribute("aria-label", data.birthDate ?
    `${dimensions}的人生周历，已走过 ${progress.elapsed} 周，剩余 ${progress.remaining} 周。` :
    `${dimensions}的人生周历。先通过设置输入出生日期。`);
  glow.hidden = progress.current === null || !data.breathing;
  if (progress.current !== null) {
    const p = pointAt(progress.current, layout);
    glow.style.left = `${p.x}px`; glow.style.top = `${p.y}px`;
    glow.style.width = glow.style.height = `${layout.radius * 2}px`;
  }
  if (editor.open) positionEditor();
}
function openSettings(): void {
  tooltip.hidden = true;
  element("toast").hidden = true;
  birthInput.value = data.birthDate ?? "";
  birthInput.max = localToday().toISOString().slice(0, 10);
  breathingInput.checked = data.breathing;
  orientationInput.value = data.orientation;
  centeredInput.checked = data.centered;
  displayScaleInput.value = data.displayScale;
  element("settings-error").hidden = true;
  if (!settings.open) settings.showModal();
  birthInput.focus();
}
function showMode(value: boolean): void {
  interactive = value;
  document.body.classList.toggle("interactive", value);
  canvas.tabIndex = value ? 0 : -1;
  tooltip.hidden = true;
  if (!value) {
    editor.close(); settings.close(); selected = null;
    element("toast").hidden = true;
    clearTimeout(toastTimer);
  }
  updateNotice(); render();
  if (value && ready && !data.birthDate && !loadError) openSettings();
  element("preview-wake").hidden = native || value;
}
async function persist(next: AppData): Promise<void> {
  if (loadError) throw new Error("请先恢复数据，原文件不会被覆盖。");
  data = await saveData(next);
}
function draft(requireTitle = false): AppData {
  if (!editor.open || selected === null) return data;
  const title = titleInput.value.trim();
  const details = detailsInput.value;
  if (!title) {
    if (!requireTitle && !details.trim() && !data.milestones[selected]) return data;
    throw new Error("请填写标题；移除已有记录请使用「删除标记」。");
  }
  const mark: Milestone = { title, details, kind: kindInput.value as Milestone["kind"], color: colorInput.value };
  return { ...data, milestones: { ...data.milestones, [selected]: mark } };
}
async function saveDraft(requireTitle = false): Promise<void> {
  const next = draft(requireTitle);
  if (next !== data) await persist(next);
}
function closeEditor(): void { editor.close(); selected = null; tooltip.hidden = true; }
function settingsDraft(): AppData {
  const birthDate = birthInput.value;
  validateBirthday(birthDate);
  return { ...data, birthDate, breathing: breathingInput.checked, centered: centeredInput.checked,
    orientation: orientationInput.value as AppData["orientation"], displayScale: displayScaleInput.value as AppData["displayScale"] };
}
async function action(task: () => void | Promise<void>): Promise<void> {
  if (busy || !ready) return;
  busy = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("button");
  buttons.forEach(button => { button.disabled = true; });
  try { await task(); }
  catch (error) {
    const dialog = settings.open ? settings : editor.open ? editor : null;
    if (dialog) {
      const node = element(`${dialog.id}-error`);
      node.textContent = errorMessage(error); node.hidden = false;
    } else toast(errorMessage(error));
  } finally {
    busy = false;
    buttons.forEach(button => { button.disabled = false; });
    render();
  }
}
function onAction(id: string, event: string, task: () => void | Promise<void>): void {
  element(id).addEventListener(event, event => { event.preventDefault(); void action(task); });
}
async function finishEditing(quit = false): Promise<void> {
  await action(async () => {
    const next = settings.open && (birthInput.value || data.birthDate) ? settingsDraft() : draft();
    // A single write saves the draft and latest dragged window position.
    if (!loadError || next !== data) await persist(next);
    await changeMode(false);
    showMode(false);
    if (quit) await quitApp();
  });
}
function setColor(color: string): void {
  colorInput.value = color;
  document.querySelectorAll<HTMLButtonElement>(".swatch").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.color?.toLowerCase() === color.toLowerCase()));
  });
}
function positionEditor(): void {
  if (selected === null) return;
  const p = pointAt(selected, layout);
  const rect = canvas.getBoundingClientRect();
  const w = editor.offsetWidth, h = editor.offsetHeight;
  const x = rect.left + p.x, y = rect.top + p.y;
  const left = x + w + 16 <= window.innerWidth ? x + 12 : x - w - 12;
  const top = y + h + 16 <= window.innerHeight ? y + 12 : y - h - 12;
  editor.style.left = `${Math.max(12, Math.min(left, window.innerWidth - w - 12))}px`;
  editor.style.top = `${Math.max(12, Math.min(top, window.innerHeight - h - 12))}px`;
}
function openWeek(index: number): void {
  if (!data.birthDate) { openSettings(); return; }
  element("toast").hidden = true;
  selected = index; keyboardWeek = index;
  const mark = data.milestones[index];
  const progress = getProgress(data.birthDate);
  element("editor-heading").textContent = weekDescription(index);
  element("editor-date").textContent = weekDates(index, data.birthDate);
  titleInput.value = mark?.title ?? "";
  detailsInput.value = mark?.details ?? "";
  kindInput.value = mark?.kind ?? (index <= (progress.current ?? progress.elapsed) ? "milestone" : "wish");
  setColor(mark?.color ?? "#FACC15");
  element("delete-mark").hidden = !mark;
  element("editor-error").hidden = true;
  tooltip.hidden = true;
  if (!editor.open) editor.show();
  titleInput.focus();
}

const palette: [string, string][] = [
  ["#FACC15", "琥珀金"], ["#38BDF8", "天际蓝"], ["#A855F7", "罗兰紫"],
  ["#34D399", "薄荷绿"], ["#FB7185", "玫瑰粉"], ["#E5E5E5", "亮白"],
];
for (const [color, label] of palette) {
  const button = document.createElement("button");
  button.type = "button"; button.className = "swatch"; button.dataset.color = color;
  button.style.setProperty("--swatch", color);
  button.setAttribute("aria-label", label); button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => setColor(color));
  element("swatches").append(button);
}
colorInput.addEventListener("input", () => setColor(colorInput.value));
element("preview-wake").addEventListener("click", () => showMode(true));

function pointerWeek(event: MouseEvent): number | null {
  const rect = canvas.getBoundingClientRect();
  return hitTest(event.clientX - rect.left, event.clientY - rect.top, layout);
}

canvas.addEventListener("pointermove", event => {
  if (!interactive || editor.open || settings.open || !ready) { tooltip.hidden = true; return; }
  const index = pointerWeek(event);
  if (index === null) { tooltip.hidden = true; return; }
  const progress = getProgress(data.birthDate);
  const mark = data.milestones[index];
  tooltip.textContent = `${weekDescription(index)} · ${weekStatus(index, progress.current, progress.elapsed)}\n${weekDates(index, data.birthDate)}${mark ? "\n" + mark.title : ""}`;
  tooltip.hidden = false;
  tooltip.style.left = `${Math.max(8, Math.min(event.clientX + 12, window.innerWidth - tooltip.offsetWidth - 8))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(event.clientY + 12, window.innerHeight - tooltip.offsetHeight - 8))}px`;
});
canvas.addEventListener("pointerleave", () => { tooltip.hidden = true; });
canvas.addEventListener("click", event => {
  if (!interactive || settings.open) return;
  const index = pointerWeek(event);
  if (index === null) { if (editor.open) void finishEditing(); return; }
  void action(async () => { await saveDraft(); openWeek(index); });
});
canvas.addEventListener("keydown", event => {
  if (!interactive || editor.open || settings.open) return;
  const horizontal = data.orientation === "horizontal";
  const x = horizontal ? WEEKS_PER_YEAR : 1, y = horizontal ? 1 : WEEKS_PER_YEAR;
  const steps: Record<string, number> = { ArrowLeft: -x, ArrowRight: x, ArrowUp: -y, ArrowDown: y };
  if (event.key in steps) {
    event.preventDefault();
    keyboardWeek = Math.max(0, Math.min(TOTAL_WEEKS - 1, keyboardWeek + steps[event.key]));
    selected = keyboardWeek; render();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault(); void action(() => openWeek(keyboardWeek));
  }
});
onAction("milestone-form", "submit", async () => {
  await saveDraft(true); closeEditor(); toast("已保存标记");
});
onAction("close-editor", "click", async () => { await saveDraft(); closeEditor(); });
onAction("delete-mark", "click", async () => {
  if (selected === null) return;
  const milestones = { ...data.milestones }; delete milestones[selected];
  await persist({ ...data, milestones }); closeEditor(); toast("已删除标记");
});
onAction("settings-button", "click", async () => {
  await saveDraft(); closeEditor(); openSettings();
});
onAction("settings-form", "submit", async () => {
  await persist(settingsDraft()); settings.close(); toast("已保存设置");
});
element("close-settings").addEventListener("click", () => { settings.close(); });
element("done-button").addEventListener("click", () => { void finishEditing(); });
onAction("recover-button", "click", async () => {
  data = await recoverData(); loadError = null;
  updateNotice(); toast("已恢复可用数据，损坏原件已保留");
  if (!data.birthDate) openSettings();
});
element("drag-handle").addEventListener("pointerdown", event => {
  if (interactive && event.button === 0 && !(event.target as HTMLElement).closest("button")) {
    void beginDrag().catch(error => toast(errorMessage(error)));
  }
});
document.addEventListener("pointerdown", event => {
  if (!interactive || settings.open || !editor.open || !ready) return;
  const target = event.target as HTMLElement;
  if (!editor.contains(target) && !target.closest("canvas, button, header")) void finishEditing();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && interactive) { event.preventDefault(); void finishEditing(); }
  if (!native && event.ctrlKey && event.altKey && event.key.toLowerCase() === "l") {
    event.preventDefault(); if (interactive) void finishEditing(); else showMode(true);
  }
});
for (const dialog of [settings, editor]) dialog.addEventListener("cancel", event => {
  event.preventDefault(); void finishEditing();
});
settings.addEventListener("click", event => {
  if (event.target !== settings) return;
  const rect = settings.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
    void finishEditing();
  }
});
document.addEventListener("visibilitychange", () => {
  document.body.classList.toggle("page-hidden", document.hidden);
  if (!document.hidden) render();
});
new ResizeObserver(() => render()).observe(canvas);
function watchDpr(): void {
  const query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  query.addEventListener("change", () => { render(); watchDpr(); }, { once: true });
}
watchDpr();
function scheduleDateRefresh(): void {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  setTimeout(() => { render(); scheduleDateRefresh(); }, next - now.getTime() + 1000);
}
scheduleDateRefresh();
async function boot(): Promise<void> {
  await subscribe(showMode, quit => { void finishEditing(quit); });
  const snapshot = await loadSnapshot();
  data = snapshot.data; loadError = snapshot.loadError; warning = snapshot.warning;
  element("data-path").textContent = snapshot.dataPath;
  ready = true; showMode(snapshot.interactive);
}
void boot().catch(error => {
  ready = true; loadError = errorMessage(error); showMode(true);
});
