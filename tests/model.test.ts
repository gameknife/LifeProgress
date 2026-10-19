import test from "node:test";
import assert from "node:assert/strict";
import { getProgress, weekDates, parseBirthDate, validateBirthday, TOTAL_WEEKS } from "../src/model.ts";
import { calendarLayout, hitTest, pointAt } from "../src/calendar.ts";

test("4,680 cells and birthday boundaries align to complete age rows", () => {
  assert.equal(TOTAL_WEEKS, 4680);
  assert.equal(getProgress("2000-01-01", new Date(2000, 0, 1)).current, 0);
  assert.equal(getProgress("2000-01-01", new Date(2000, 11, 31)).current, 51);
  assert.equal(getProgress("2000-01-01", new Date(2001, 0, 1)).current, 52);
  assert.equal(getProgress("2000-01-01", new Date(2090, 0, 1)).current, null);
  assert.equal(getProgress("2000-01-01", new Date(2090, 0, 1)).remaining, 0);
  assert.equal(getProgress("2000-01-01", new Date(2090, 0, 1)).percent, 100);
  assert.equal(getProgress(null).current, null);
});
test("Feb 29 anniversary is Feb 28 in common years and Feb 29 in leap years", () => {
  assert.equal(getProgress("2000-02-29", new Date(2001, 1, 27)).current, 51);
  assert.equal(getProgress("2000-02-29", new Date(2001, 1, 28)).current, 52);
  assert.equal(getProgress("2000-02-29", new Date(2004, 1, 28)).current, 207);
  assert.equal(getProgress("2000-02-29", new Date(2004, 1, 29)).current, 208);
});
test("date ranges cover each civil day once including leap-year end", () => {
  assert.equal(weekDates(0, "2000-01-01"), "2000-01-01 — 2000-01-08");
  assert.equal(weekDates(51, "2000-01-01"), "2000-12-25 — 2000-12-31");
  for (let week = 0; week < 51; week++) {
    const end = weekDates(week, "2000-02-29").split(" — ")[1];
    const start = weekDates(week + 1, "2000-02-29").split(" — ")[0];
    assert.equal(Date.parse(start) - Date.parse(end), 86_400_000);
  }
});
test("invalid and future birthdays are rejected", () => {
  assert.throws(() => parseBirthDate("2024-02-30"));
  assert.throws(() => parseBirthDate("2024-2-03"));
  assert.throws(() => validateBirthday("2026-10-01", new Date(2026, 8, 30)));
  assert.doesNotThrow(() => validateBirthday("2026-09-30", new Date(2026, 8, 30)));
});
test("hit testing supports edges and rejects canvas margins and gaps", () => {
  const layout = calendarLayout(470, 780);
  for (const index of [0, 51, 52, 1631, 4679]) {
    const p = pointAt(index, layout);
    assert.equal(hitTest(p.x, p.y, layout), index);
  }
  assert.equal(hitTest(0, 0, layout), null);
  assert.equal(hitTest(layout.x + 52 * layout.spacing + 1, layout.y + 1, layout), null);
  const p = pointAt(0, layout);
  assert.equal(hitTest(p.x + layout.spacing * .49, p.y, layout), null);
});

test("both orientations preserve every week index and center the grid", () => {
  for (const orientation of ["horizontal", "vertical"] as const) {
    const layout = calendarLayout(876, 460, orientation);
    for (let index = 0; index < TOTAL_WEEKS; index++) {
      const point = pointAt(index, layout);
      assert.equal(hitTest(point.x, point.y, layout), index);
    }
    const first = pointAt(0, layout), last = pointAt(TOTAL_WEEKS - 1, layout);
    assert.ok(Math.abs((first.x + last.x) / 2 - layout.width / 2) < 1e-8);
    assert.ok(Math.abs((first.y + last.y) / 2 - layout.height / 2) < 1e-8);
    assert.equal(hitTest(layout.x - 1, layout.y, layout), null);
    assert.equal(hitTest(last.x + layout.spacing, last.y, layout), null);
  }
});
