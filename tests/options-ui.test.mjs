import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../options.html", import.meta.url), "utf8");
const script = await readFile(new URL("../options.js", import.meta.url), "utf8");

function viewMarkup(name) {
  const start = html.indexOf(`data-view-panel="${name}"`);
  assert.notEqual(start, -1, `missing ${name} view`);
  const next = html.indexOf('data-view-panel="', start + 24);
  return html.slice(start, next === -1 ? undefined : next);
}

test("settings navigation follows the user-facing mental model", () => {
  const labels = [...html.matchAll(/class="nav-item"[^>]*>([^<]+)<\/button>/g)]
    .map((match) => match[1]);
  assert.deepEqual(labels, [
    "Insights",
    "Focus",
    "Routines",
    "Tabs",
    "AI assistance",
    "Data &amp; privacy"
  ]);
});

test("local tab grouping is owned by Tabs rather than AI", () => {
  assert.match(viewMarkup("tabs"), /id="link-trail-grouping-enabled"/);
  assert.match(viewMarkup("tabs"), /id="tab-crowding-suggestions-enabled"/);
  assert.match(viewMarkup("tabs"), /Adapts to the width of your current Chrome window/);
  assert.doesNotMatch(viewMarkup("ai"), /id="link-trail-grouping-enabled"/);
  assert.match(viewMarkup("tabs"), /works without AI/);
});

test("focus copy explains strict behavior without a fake temporary-access setting", () => {
  assert.match(viewMarkup("focus"), /Ending early asks for a reason and waits 20 seconds/);
  assert.doesNotMatch(viewMarkup("focus"), /Temporary access/);
  assert.match(script, /view === "protection" \? "focus"/);
});

test("routine creation is grouped into three clear decisions", () => {
  const routines = viewMarkup("routines");
  assert.match(routines, />Schedule</);
  assert.match(routines, />Focus level</);
  assert.match(routines, />Sites and topic</);
});

test("privacy copy is accurate and data controls are wired", () => {
  const data = viewMarkup("data");
  assert.doesNotMatch(html, /Everything stays on this device/);
  assert.match(data, /remote model/);
  assert.match(data, /id="clear-activity-history"/);
  assert.match(data, /id="clear-intentions"/);
  assert.match(script, /addEventListener\("click", clearActivityHistory\)/);
  assert.match(script, /addEventListener\("click", clearIntentions\)/);
});

test("category reset remains visible and named in Insights", () => {
  assert.match(viewMarkup("insights"), />Reset category learning<\/span>/);
});
