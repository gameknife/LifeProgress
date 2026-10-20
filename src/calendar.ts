import { TOTAL_WEEKS, WEEKS_PER_YEAR, YEARS, type AppData, getProgress } from "./model.ts";

export interface Layout { width: number; height: number; spacing: number; x: number; y: number; radius: number }
export function calendarLayout(width: number, height: number): Layout {
  const spacing = Math.min((width - 24) / YEARS, (height - 24) / WEEKS_PER_YEAR);
  return { width, height, spacing, x: (width - spacing * YEARS) / 2,
    y: (height - spacing * WEEKS_PER_YEAR) / 2, radius: Math.max(0.65, spacing * 0.22) };
}
export function pointAt(index: number, layout: Layout) {
  const age = Math.floor(index / WEEKS_PER_YEAR), week = index % WEEKS_PER_YEAR;
  return { x: layout.x + (age + 0.5) * layout.spacing, y: layout.y + (week + 0.5) * layout.spacing };
}
export function hitTest(x: number, y: number, layout: Layout): number | null {
  const col = Math.floor((x - layout.x) / layout.spacing);
  const row = Math.floor((y - layout.y) / layout.spacing);
  if (layout.spacing <= 0) return null;
  if (col < 0 || col >= YEARS || row < 0 || row >= WEEKS_PER_YEAR) return null;
  const index = col * WEEKS_PER_YEAR + row;
  const center = pointAt(index, layout);
  return Math.hypot(x - center.x, y - center.y) <= layout.spacing * 0.46 ? index : null;
}
export function drawCalendar(canvas: HTMLCanvasElement, data: AppData, interactive: boolean, selected: number | null): Layout {
  const { width, height } = canvas.getBoundingClientRect();
  const layout = calendarLayout(width, height);
  if (layout.spacing <= 0) return layout;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  const progress = getProgress(data.birthDate);
  for (let index = 0; index < TOTAL_WEEKS; index++) {
    const { x, y } = pointAt(index, layout);
    const mark = data.milestones[index];
    context.fillStyle = mark?.color ?? (index < progress.elapsed ? "#E5E5E5" : "#262626");
    context.beginPath();
    context.arc(x, y, mark ? layout.radius * 1.25 : layout.radius, 0, Math.PI * 2);
    context.fill();
    // Current week always stays red; a colored halo preserves its milestone color.
    if (index === progress.current) {
      if (mark) {
        context.strokeStyle = mark.color;
        context.lineWidth = 1;
        context.beginPath(); context.arc(x, y, layout.radius * 1.8, 0, Math.PI * 2); context.stroke();
      }
      context.fillStyle = "#EF4444";
      context.beginPath(); context.arc(x, y, layout.radius, 0, Math.PI * 2); context.fill();
    }
    if (index === selected && interactive) {
      context.strokeStyle = "#E5E5E5"; context.lineWidth = 1;
      context.beginPath(); context.arc(x, y, layout.spacing * 0.43, 0, Math.PI * 2); context.stroke();
    }
  }
  if (interactive) {
    context.fillStyle = "#525252"; context.font = "9px Consolas, monospace";
    context.textAlign = "center"; context.textBaseline = "middle";
    for (let age = 0; age < YEARS; age += 10) {
      const p = pointAt(age * WEEKS_PER_YEAR, layout);
      context.fillText(String(age), p.x, layout.y - 6);
    }
  }
  return layout;
}
