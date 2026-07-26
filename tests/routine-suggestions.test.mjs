import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const suggestionCode = await readFile(
  new URL("../routine-suggestions.js", import.meta.url),
  "utf8"
);

function loadEngine() {
  const context = { Date, Map, Math, Number, Object, Set, String, globalThis: {} };
  vm.runInNewContext(suggestionCode, context);
  return context.globalThis.StillRoutineSuggestions;
}

function key(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function patternData({ impulseDays = 12, focusSessions = [], routines = [] } = {}) {
  const now = new Date(2027, 2, 28, 18, 0, 0, 0);
  const stats = {};
  const weekdays = [];
  for (let offset = 27; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    stats[key(date)] = { impulsesPaused: 1 };
    if (date.getDay() > 0 && date.getDay() < 6) weekdays.push(date);
  }
  const impulseEvents = [];
  for (const date of weekdays.slice(-impulseDays)) {
    for (let index = 0; index < 2; index += 1) {
      const at = new Date(date);
      at.setHours(14, 10 + index * 20, 0, 0);
      impulseEvents.push({
        host: index === 0 ? "reddit.com" : "youtube.com",
        createdAt: at.getTime()
      });
    }
  }
  return {
    now: now.getTime(),
    data: { stats, impulseEvents, focusSessions, routines }
  };
}

test("suggests the strongest repeated distraction window with its top sites", () => {
  const engine = loadEngine();
  const { data, now } = patternData();
  const suggestion = engine.generate(data, now);

  assert.equal(suggestion.routine.startTime, "14:00");
  assert.equal(suggestion.routine.endTime, "16:00");
  assert.deepEqual(Array.from(suggestion.routine.days), [1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(suggestion.siteHosts), ["reddit.com", "youtube.com"]);
  assert.equal(suggestion.routine.mode, "mindful");
  assert.ok(suggestion.lift >= 1.5);
});

test("does not suggest a routine before the evidence threshold", () => {
  const engine = loadEngine();
  const { data, now } = patternData({ impulseDays: 2 });
  assert.equal(engine.generate(data, now), null);
});

test("does not suggest a window already covered by an enabled routine", () => {
  const engine = loadEngine();
  const { data, now } = patternData({
    routines: [
      {
        enabled: true,
        days: [1, 2, 3, 4, 5],
        startTime: "13:30",
        endTime: "15:30"
      }
    ]
  });
  assert.equal(engine.generate(data, now), null);
});

test("recommends strict focus when successful focus already happens in the window", () => {
  const completed = [];
  const base = patternData();
  const matchingDates = Object.keys(base.data.stats)
    .map((value) => new Date(`${value}T14:15:00`))
    .filter((date) => date.getDay() > 0 && date.getDay() < 6)
    .slice(-4);
  for (const date of matchingDates) {
    completed.push({
      startedAt: date.getTime(),
      focusedSeconds: 30 * 60,
      completed: true
    });
  }
  const engine = loadEngine();
  const suggestion = engine.generate(
    { ...base.data, focusSessions: completed },
    base.now
  );
  assert.equal(suggestion.routine.mode, "strict");
});
