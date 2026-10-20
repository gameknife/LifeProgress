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
  version: 2;
  birthDate: string | null;
  milestones: Record<string, Milestone>;
}
export function emptyData(): AppData {
  return { version: 2, birthDate: null, milestones: {} };
}

export function parseBirthDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("请输入完整的出生日期。");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.toISOString().slice(0, 10) !== value) throw new Error("请输入有效的出生日期（1900 年起）。");
  return date;
}
export function localToday(now = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
export function validateBirthday(value: string, now = new Date()): void {
  if (parseBirthDate(value).getTime() > localToday(now).getTime()) throw new Error("出生日期不能晚于今天。");
}
function anniversary(birth: Date, year: number): Date {
  const month = birth.getUTCMonth();
  const day = Math.min(birth.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day));
}
/** Each birthday-to-birthday year has exactly 52 cells; Feb 29 uses Feb 28 in common years. */
export function getProgress(birthDate: string | null, now = new Date()) {
  if (!birthDate) return { elapsed: 0, current: null, remaining: TOTAL_WEEKS, percent: 0 };
  const birth = parseBirthDate(birthDate);
  const today = localToday(now);
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  if (today < anniversary(birth, today.getUTCFullYear())) age--;
  if (age < 0) return { elapsed: 0, current: null, remaining: TOTAL_WEEKS, percent: 0 };
  if (age >= YEARS) return { elapsed: TOTAL_WEEKS, current: null, remaining: 0, percent: 100 };
  const start = anniversary(birth, birth.getUTCFullYear() + age).getTime();
  const end = anniversary(birth, birth.getUTCFullYear() + age + 1).getTime();
  const week = Math.min(51, Math.floor((today.getTime() - start) / (end - start) * WEEKS_PER_YEAR));
  const elapsed = age * WEEKS_PER_YEAR + week;
  return { elapsed, current: elapsed, remaining: TOTAL_WEEKS - elapsed, percent: elapsed / TOTAL_WEEKS * 100 };
}
export function weekDescription(index: number): string {
  return `${Math.floor(index / WEEKS_PER_YEAR)} 岁 · 第 ${index % WEEKS_PER_YEAR + 1} 周`;
}
export function weekDates(index: number, birthDate: string | null): string {
  if (!birthDate) return "先设置出生日期";
  const birth = parseBirthDate(birthDate);
  const year = birth.getUTCFullYear() + Math.floor(index / WEEKS_PER_YEAR);
  const start = anniversary(birth, year).getTime();
  const days = (anniversary(birth, year + 1).getTime() - start) / DAY;
  const col = index % WEEKS_PER_YEAR;
  const from = new Date(start + Math.ceil(col * days / WEEKS_PER_YEAR) * DAY);
  const to = new Date(start + (Math.ceil((col + 1) * days / WEEKS_PER_YEAR) - 1) * DAY);
  return `${from.toISOString().slice(0, 10)} — ${to.toISOString().slice(0, 10)}`;
}
