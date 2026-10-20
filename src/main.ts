import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { drawCalendar, hitTest, type Layout } from "./calendar";
import { emptyData, getProgress, localToday, validateBirthday, weekDates, weekDescription, TOTAL_WEEKS, WEEKS_PER_YEAR, type AppData } from "./model";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}
interface Snapshot {
  data: AppData; interactive: boolean; loadError: string | null; warning: string | null;
}
const canvas = element<HTMLCanvasElement>("weeks");
const editor = element<HTMLDialogElement>("editor");
const titleInput = element<HTMLInputElement>("mark-title");
const detailsInput = element<HTMLTextAreaElement>("mark-details");
const colorInput = element<HTMLInputElement>("mark-color");
const birthInput = element<HTMLInputElement>("birth-date");
let data = emptyData();
let interactive = false;
let selected: number | null = null;
let keyboardWeek = 0;
let layout: Layout;
let busy = false;
let ready = false;
let loadError: string | null = null;
let warning: string | null = null;
let error: string | null = null;

function render(): void {
  layout = drawCalendar(canvas, data, interactive, selected);
  const progress = getProgress(data.birthDate);
  element("remaining").textContent = data.birthDate ? `${progress.remaining}w left` : "—w left";
  element("percent").textContent = data.birthDate ? `${progress.percent.toFixed(1)}%` : "—%";
  element("life-caption").textContent = !data.birthDate ? "Ctrl+Alt+L · 设置出生日期" :
    progress.current === null ? "90 年 · 每一周都曾属于你" : `${weekDescription(progress.current)} · ${interactive ? "编辑中" : "Ctrl+Alt+L 编辑"}`;
  element("mark-count").textContent = `${Object.keys(data.milestones).length} 个标记`;
  canvas.setAttribute("aria-label", data.birthDate ?
    `52 行、90 列的人生周历，已走过 ${progress.elapsed} 周，剩余 ${progress.remaining} 周。` :
    "52 行、90 列的人生周历。先输入出生日期。");
  const message = error || (loadError ? `数据未载入：${loadError}。恢复会保留损坏原件；有备份则恢复，否则重新设置。` : warning);
  const notice = element("notice");
  element(editor.open ? "milestone-form" : "app").append(notice);
  notice.hidden = !interactive || !message;
  element("notice-text").textContent = message;
  element("recover-button").hidden = !loadError;
  if (message && editor.open) notice.scrollIntoView({ block: "nearest" });
  birthInput.max = localToday().toISOString().slice(0, 10);
}
function closeEditor(): void { editor.close(); selected = null; canvas.title = ""; }
function showMode(value: boolean): void {
  interactive = value;
  document.body.classList.toggle("interactive", value);
  canvas.tabIndex = value ? 0 : -1;
  canvas.title = "";
  if (!value) closeEditor();
  render();
  if (value && !data.birthDate) birthInput.focus();
}
function draft(requireTitle = false): AppData {
  const birthDate = birthInput.value || null;
  if (birthDate || data.birthDate) validateBirthday(birthDate ?? "");
  const next = { ...data, birthDate };
  if (!editor.open || selected === null) return next;
  const title = titleInput.value.trim(), details = detailsInput.value;
  if (!title) {
    if (!requireTitle && !details.trim() && !data.milestones[selected]) return next;
    throw new Error("请填写标题；移除已有记录请使用「删除标记」。");
  }
  return { ...next, milestones: { ...data.milestones, [selected]: { title, details, color: colorInput.value } } };
}
async function persist(next = draft()): Promise<void> {
  if (loadError) throw new Error("请先恢复数据，原文件不会被覆盖。");
  data = await invoke<AppData>("save_data", { data: next });
}
async function action(task: () => void | Promise<void>): Promise<void> {
  if (busy || !ready) return;
  busy = true; error = null;
  const buttons = document.querySelectorAll<HTMLButtonElement>("button");
  buttons.forEach(button => { button.disabled = true; });
  try { await task(); }
  catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  finally {
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
    if (!loadError || birthInput.value || editor.open) await persist();
    await invoke("set_mode", { interactive: false });
    if (quit) await invoke("quit_app");
  });
}
async function openWeek(index: number): Promise<void> {
  if (editor.open || birthInput.value !== (data.birthDate ?? "")) await persist();
  if (!data.birthDate) { birthInput.focus(); return; }
  selected = index; keyboardWeek = index;
  const mark = data.milestones[index];
  element("editor-heading").textContent = weekDescription(index);
  element("editor-date").textContent = weekDates(index, data.birthDate);
  titleInput.value = mark?.title ?? "";
  detailsInput.value = mark?.details ?? "";
  colorInput.value = mark?.color ?? "#FACC15";
  element("delete-mark").hidden = !mark;
  canvas.title = "";
  if (!editor.open) editor.show();
  titleInput.focus();
}
function pointerWeek(event: MouseEvent): number | null {
  const rect = canvas.getBoundingClientRect();
  return hitTest(event.clientX - rect.left, event.clientY - rect.top, layout);
}

canvas.addEventListener("pointermove", event => {
  if (!interactive || editor.open || !ready) return;
  const index = pointerWeek(event);
  canvas.title = index === null ? "" : `${weekDescription(index)}\n${weekDates(index, data.birthDate)}\n${data.milestones[index]?.title ?? ""}`;
});
canvas.addEventListener("click", event => {
  if (!interactive || !ready) return;
  const index = pointerWeek(event);
  if (index === null) { if (editor.open) void finishEditing(); return; }
  void action(() => openWeek(index));
});
canvas.addEventListener("keydown", event => {
  if (!interactive || editor.open) return;
  const steps: Record<string, number> = { ArrowLeft: -WEEKS_PER_YEAR, ArrowRight: WEEKS_PER_YEAR, ArrowUp: -1, ArrowDown: 1 };
  if (event.key in steps) {
    event.preventDefault();
    keyboardWeek = Math.max(0, Math.min(TOTAL_WEEKS - 1, keyboardWeek + steps[event.key]));
    selected = keyboardWeek; render();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault(); void action(() => openWeek(keyboardWeek));
  }
});
onAction("birth-date", "change", () => persist());
onAction("milestone-form", "submit", async () => { await persist(draft(true)); closeEditor(); });
onAction("close-editor", "click", async () => { await persist(); closeEditor(); });
onAction("delete-mark", "click", async () => {
  if (selected === null) return;
  const milestones = { ...data.milestones }; delete milestones[selected];
  await persist({ ...data, milestones }); closeEditor();
});
onAction("recover-button", "click", async () => {
  data = await invoke<AppData>("recover_data"); loadError = null;
  birthInput.value = data.birthDate ?? "";
  if (!data.birthDate) birthInput.focus();
});
element("done-button").addEventListener("click", () => { void finishEditing(); });
element("drag-handle").addEventListener("pointerdown", event => {
  if (interactive && event.button === 0 && !(event.target as HTMLElement).closest("button, input, label")) {
    void action(() => invoke("begin_drag"));
  }
});
document.addEventListener("pointerdown", event => {
  if (!interactive || !editor.open || !ready) return;
  const target = event.target as HTMLElement;
  if (!editor.contains(target) && !target.closest("canvas, button, header")) void finishEditing();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && interactive) { event.preventDefault(); void finishEditing(); }
});
editor.addEventListener("cancel", event => { event.preventDefault(); void finishEditing(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
new ResizeObserver(render).observe(canvas);
function watchDpr(): void {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    .addEventListener("change", () => { render(); watchDpr(); }, { once: true });
}
watchDpr();
function scheduleDateRefresh(): void {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  setTimeout(() => { render(); scheduleDateRefresh(); }, next - now.getTime() + 1000);
}
scheduleDateRefresh();
async function boot(): Promise<void> {
  await listen<boolean>("mode-changed", event => showMode(event.payload));
  await listen<boolean>("finish-editing", event => { void finishEditing(event.payload); });
  const snapshot = await invoke<Snapshot>("load_data");
  data = snapshot.data; loadError = snapshot.loadError; warning = snapshot.warning;
  birthInput.value = data.birthDate ?? "";
  ready = true; showMode(snapshot.interactive);
}
void boot().catch(cause => { ready = true; loadError = String(cause); showMode(true); });
