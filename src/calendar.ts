import { TOTAL_WEEKS, WEEKS_PER_YEAR, YEARS, type Milestone } from "./model.ts";

export interface Layout { x: number; y: number; spacing: number }

/** The 90 × 52 grid, centered with a 12px margin. */
export function calendarLayout(width: number, height: number): Layout {
  const spacing = Math.min((width - 24) / YEARS, (height - 24) / WEEKS_PER_YEAR);
  return { spacing, x: (width - spacing * YEARS) / 2, y: (height - spacing * WEEKS_PER_YEAR) / 2 };
}
export function pointAt(index: number, { x, y, spacing }: Layout) {
  return { x: x + (Math.floor(index / WEEKS_PER_YEAR) + 0.5) * spacing, y: y + (index % WEEKS_PER_YEAR + 0.5) * spacing };
}
export function hitTest(x: number, y: number, layout: Layout): number | null {
  const col = Math.floor((x - layout.x) / layout.spacing), row = Math.floor((y - layout.y) / layout.spacing);
  if (col < 0 || col >= YEARS || row < 0 || row >= WEEKS_PER_YEAR) return null;
  const index = col * WEEKS_PER_YEAR + row, center = pointAt(index, layout);
  return Math.hypot(x - center.x, y - center.y) <= layout.spacing * 0.46 ? index : null;
}

export function drawCalendar(canvas: HTMLCanvasElement, milestones: Record<number, Milestone>,
  lived: number | null, selected: number | null, labels: boolean): Layout {
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.round(width * devicePixelRatio);
  canvas.height = Math.round(height * devicePixelRatio);
  const context = canvas.getContext("2d")!;
  context.scale(devicePixelRatio, devicePixelRatio);
  const layout = calendarLayout(width, height), radius = Math.max(0.65, layout.spacing * 0.22);
  const circle = (x: number, y: number, r: number, color: string, ring = false) => {
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    if (ring) { context.strokeStyle = color; context.stroke(); } else { context.fillStyle = color; context.fill(); }
  };
  for (let index = 0; index < TOTAL_WEEKS; index++) {
    const { x, y } = pointAt(index, layout), mark = milestones[index];
    circle(x, y, mark ? radius * 1.25 : radius, mark?.color ?? (index < (lived ?? 0) ? "#e5e5e5" : "#262626"));
    // The current week stays red; a halo keeps its milestone color visible.
    if (index === lived) {
      if (mark) circle(x, y, radius * 1.8, mark.color, true);
      circle(x, y, radius, "#ef4444");
    }
    if (index === selected) circle(x, y, layout.spacing * 0.43, "#e5e5e5", true);
  }
  if (labels) {
    Object.assign(context, { fillStyle: "#525252", font: "9px Consolas, monospace", textAlign: "center", textBaseline: "middle" });
    for (let age = 0; age < YEARS; age += 10) context.fillText(String(age), pointAt(age * WEEKS_PER_YEAR, layout).x, layout.y - 6);
  }
  return layout;
}
