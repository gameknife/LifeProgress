import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { drawCalendar, hitTest, type Layout } from "./calendar";
import { localToday, weekDates, weekDescription, weeksLived, TOTAL_WEEKS, WEEKS_PER_YEAR, type AppData } from "./model";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("weeks");
const editor = $<HTMLDialogElement>("editor");
const titleInput = $<HTMLInputElement>("mark-title");
const detailsInput = $<HTMLTextAreaElement>("mark-details");
const colorInput = $<HTMLInputElement>("mark-color");
const birthInput = $<HTMLInputElement>("birth-date");
const scaleInput = $<HTMLSelectElement>("display-scale");
const tooltip = $("week-tooltip");
const notice = $("notice");
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

let data: AppData = { birthDate: null, displayScale: "medium", milestones: {} };
let interactive = false;
let selected: number | null = null;
let cursor = 0;
let layout: Layout;
let busy = true; // until the data has loaded
let error = "";
let day = "";

function render(): void {
  day = new Date().toDateString();
  const lived = data.birthDate ? weeksLived(data.birthDate) : null;
  layout = drawCalendar(canvas, data.milestones, lived, selected, interactive);
  tooltip.hidden = true;
  $("remaining").textContent = `${lived ?? "—"} / ${TOTAL_WEEKS} weeks`;
  $("percent").textContent = lived === null ? "—%" : `${(lived / TOTAL_WEEKS * 100).toFixed(1)}%`;
  $("life-caption").textContent = lived === null ? "Ctrl+Alt+L · 设置出生日期" : lived === TOTAL_WEEKS ? "90 年 · 每一周都曾属于你" :
    `${weekDescription(lived)} · ${interactive ? "编辑中" : "Ctrl+Alt+L 编辑"}`;
  $("mark-count").textContent = `${Object.keys(data.milestones).length} 个标记`;
  canvas.ariaLabel = lived === null ? "52 行、90 列的人生周历。先输入出生日期。" :
    `52 行、90 列的人生周历，已走过 ${lived} 周，剩余 ${TOTAL_WEEKS - lived} 周。`;
  notice.textContent = error;
  notice.hidden = !error;
  birthInput.max = localToday().toISOString().slice(0, 10);
  scaleInput.value = data.displayScale;
}
function closeEditor(): void { editor.close(); selected = null; }
function showMode(value: boolean): void {
  interactive = value;
  document.body.classList.toggle("interactive", value);
  canvas.tabIndex = value ? 0 : -1;
  if (!value) closeEditor();
  render();
  if (value && !data.birthDate) birthInput.focus();
}
/** The data as the inputs show it; an untitled draft leaves marks untouched. */
function draft(): AppData {
  const next = { ...data, birthDate: birthInput.value || null, displayScale: scaleInput.value as AppData["displayScale"] };
  const title = titleInput.value.trim();
  if (editor.open && selected !== null && title) {
    next.milestones = { ...data.milestones, [selected]: { title, details: detailsInput.value, color: colorInput.value } };
  }
  return next;
}
async function save(next = draft()): Promise<void> {
  if (JSON.stringify(next) === JSON.stringify(data)) return;
  await invoke("save_data", { data: next });
  data = next;
}
/** One task at a time; a failure keeps every input and shows why. */
async function act(task: () => unknown): Promise<void> {
  if (busy) return;
  busy = true; error = "";
  try { await task(); } catch (cause) { error = String(cause); }
  busy = false; render();
}
async function finish(quit = false): Promise<void> {
  await save();
  if (quit) await invoke("quit_app");
  else await invoke("set_mode", { interactive: false });
}
async function openWeek(index: number): Promise<void> {
  await save();
  if (!data.birthDate) { birthInput.focus(); return; }
  selected = cursor = index;
  const mark = data.milestones[index];
  $("editor-heading").textContent = weekDescription(index);
  $("editor-date").textContent = weekDates(index, data.birthDate);
  titleInput.value = mark?.title ?? "";
  detailsInput.value = mark?.details ?? "";
  colorInput.value = mark?.color ?? "#facc15";
  $("delete-mark").hidden = !mark;
  editor.show();
  titleInput.focus();
}
function weekAt(x: number, y: number): number | null {
  const rect = canvas.getBoundingClientRect();
  return hitTest(x - rect.left, y - rect.top, layout);
}
function showTooltip(x: number, y: number): void {
  const index = weekAt(x, y), mark = index === null ? undefined : data.milestones[index];
  tooltip.hidden = index === null || editor.open || !(interactive || mark);
  if (index === null || tooltip.hidden) return;
  const dates = data.birthDate ? weekDates(index, data.birthDate) : "先设置出生日期";
  [weekDescription(index), dates, mark?.title, mark?.details].forEach((text, i) => { tooltip.children[i].textContent = text ?? ""; });
  tooltip.style.borderLeftColor = mark?.color ?? "#525252";
  tooltip.style.left = `${clamp(x + 12, 8, innerWidth - tooltip.offsetWidth - 8)}px`;
  tooltip.style.top = `${clamp(y + 12, 8, innerHeight - tooltip.offsetHeight - 8)}px`;
}
function on(id: string, type: string, task: () => unknown): void {
  $(id).addEventListener(type, event => { event.preventDefault(); void act(task); });
}

// Click-through windows get no pointer events, so silent mode polls the cursor while there are records to show.
setInterval(async () => {
  if (interactive || !Object.keys(data.milestones).length) return;
  const [x, y] = await invoke<[number, number]>("cursor_position");
  if (!interactive) showTooltip(x, y);
}, 120);
canvas.addEventListener("pointermove", event => { if (interactive) showTooltip(event.clientX, event.clientY); });
canvas.addEventListener("pointerleave", () => { tooltip.hidden = true; });
canvas.addEventListener("click", event => {
  const index = weekAt(event.clientX, event.clientY);
  if (interactive && index !== null) void act(() => openWeek(index));
});
const steps: Record<string, number> = { ArrowLeft: -WEEKS_PER_YEAR, ArrowRight: WEEKS_PER_YEAR, ArrowUp: -1, ArrowDown: 1 };
canvas.addEventListener("keydown", event => {
  if (!interactive || editor.open) return;
  if (event.key in steps) {
    event.preventDefault();
    selected = cursor = clamp(cursor + steps[event.key], 0, TOTAL_WEEKS - 1);
    render();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    void act(() => openWeek(cursor));
  }
});
on("birth-date", "change", () => save());
on("display-scale", "change", async () => { await save(); await invoke("set_scale", { scale: data.displayScale }); });
on("milestone-form", "submit", async () => { await save(); closeEditor(); });
on("close-editor", "click", async () => { await save(); closeEditor(); });
on("delete-mark", "click", async () => {
  const milestones = { ...data.milestones };
  delete milestones[selected!];
  await save({ ...data, milestones }); closeEditor();
});
on("done-button", "click", finish);
$("drag-handle").addEventListener("pointerdown", event => {
  if (interactive && event.button === 0 && !(event.target as Element).closest(".edit-controls")) void invoke("begin_drag");
});
// Pressing anywhere but the editor, the header, the notice or a week saves and returns to silent mode.
document.addEventListener("pointerdown", ({ target, clientX, clientY }) => {
  if (editor.open && !(target as Element).closest("dialog, header, .notice") && weekAt(clientX, clientY) === null) void act(finish);
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && interactive) { event.preventDefault(); void act(finish); }
});
new ResizeObserver(render).observe(canvas);
setInterval(() => { if (day !== new Date().toDateString()) render(); }, 60_000);
(function watchDpr(): void {
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener("change", () => { render(); watchDpr(); }, { once: true });
})();

await listen<boolean>("mode-changed", event => showMode(event.payload));
await listen<boolean>("finish-editing", event => void act(() => finish(event.payload)));
const [loaded, mode] = await invoke<[AppData, boolean]>("load_data");
data = loaded;
birthInput.value = data.birthDate ?? "";
busy = false;
showMode(mode);
