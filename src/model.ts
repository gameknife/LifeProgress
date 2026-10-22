export const WEEKS_PER_YEAR = 52;
export const YEARS = 90;
export const TOTAL_WEEKS = WEEKS_PER_YEAR * YEARS;
const DAY = 86_400_000;

export interface Milestone {
  title: string;
  details: string;
  color: string;
}
export interface AppData {
  birthDate: string | null;
  displayScale: "small" | "medium" | "large";
  milestones: Record<number, Milestone>;
}

/** Today's calendar date at UTC midnight, so date math never depends on the time zone. */
export function localToday(now = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
/** The birthday at a given age; Feb 29 falls on Feb 28 in common years. */
function birthday(birthDate: string, age: number): number {
  const [year, month, day] = birthDate.split("-").map(Number);
  return Date.UTC(year + age, month - 1, Math.min(day, new Date(Date.UTC(year + age, month, 0)).getUTCDate()));
}
/** Each birthday-to-birthday year has exactly 52 cells. */
export function weeksLived(birthDate: string, now = new Date()): number {
  const today = localToday(now).getTime();
  let age = now.getFullYear() - Number(birthDate.slice(0, 4));
  if (today < birthday(birthDate, age)) age--;
  const start = birthday(birthDate, age), end = birthday(birthDate, age + 1);
  const weeks = age * WEEKS_PER_YEAR + Math.floor((today - start) / (end - start) * WEEKS_PER_YEAR);
  return Math.max(0, Math.min(TOTAL_WEEKS, weeks));
}
export function weekDescription(index: number): string {
  return `${Math.floor(index / WEEKS_PER_YEAR)} 岁 · 第 ${index % WEEKS_PER_YEAR + 1} 周`;
}
/** A cell covers its share of the year's days, so consecutive cells never overlap or skip a day. */
export function weekDates(index: number, birthDate: string): string {
  const age = Math.floor(index / WEEKS_PER_YEAR), week = index % WEEKS_PER_YEAR;
  const start = birthday(birthDate, age), days = (birthday(birthDate, age + 1) - start) / DAY;
  const date = (offset: number) => new Date(start + offset * DAY).toISOString().slice(0, 10);
  return `${date(Math.ceil(week * days / WEEKS_PER_YEAR))} — ${date(Math.ceil((week + 1) * days / WEEKS_PER_YEAR) - 1)}`;
}
