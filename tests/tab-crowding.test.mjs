import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const code = await readFile(new URL("../tab-crowding.js", import.meta.url), "utf8");
const context = { globalThis: {} };
vm.runInNewContext(code, context);
const { estimate, groupLabelWidth } = context.globalThis.StillTabCrowding;

function tabs(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    groupId: -1,
    pinned: false,
    url: `https://example${index}.com/`,
    ...overrides
  }));
}

test("detects compressed tab titles in a laptop-sized window", () => {
  const result = estimate({ windowWidth: 1440, tabs: tabs(18) });
  assert.equal(result.isCrowded, true);
  assert.equal(result.estimatedTabWidth, 68);
  assert.equal(result.ungroupedTabs, 18);
});

test("the same tabs remain comfortable in a wide window", () => {
  const result = estimate({ windowWidth: 2400, tabs: tabs(18) });
  assert.equal(result.isCrowded, false);
  assert.equal(result.estimatedTabWidth, 121);
});

test("does not reorganize a small tab set just because the window is narrow", () => {
  const result = estimate({ windowWidth: 700, tabs: tabs(6) });
  assert.equal(result.estimatedTabWidth < 90, true);
  assert.equal(result.isCrowded, false);
});

test("collapsed group members do not count as visible tab slots", () => {
  const ungrouped = tabs(10);
  const grouped = tabs(8).map((tab, index) => ({ ...tab, id: index + 20, groupId: 7 }));
  const result = estimate({
    windowWidth: 1440,
    tabs: [...ungrouped, ...grouped],
    groups: [{ id: 7, title: "Saved research", collapsed: true }]
  });
  assert.equal(result.visibleTabs, 10);
  assert.equal(result.isCrowded, false);
  assert.equal(groupLabelWidth({ title: "Saved research" }) > 30, true);
});
