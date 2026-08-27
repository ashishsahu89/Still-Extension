import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
const script = await readFile(new URL("../popup.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../popup.css", import.meta.url), "utf8");

test("popup makes tab organization the primary home action", () => {
  assert.match(html, /id="organize-tabs"[^>]*>Organize tabs<\/button>/);
  assert.match(html, /id="quick-focus"/);
  assert.match(html, /id="quick-focus-duration"/);
  assert.match(html, /id="open-focus-options"/);
  assert.doesNotMatch(html, /Tabs are getting hard to identify/);
});

test("popup uses neutral tab status copy and preserves organize during focus", () => {
  assert.match(script, /tabs ready to organize/);
  assert.match(script, /body\.classList\.toggle\("focus-active", active\)/);
  assert.match(styles, /body\.focus-active \.organize-tabs-button/);
  assert.match(styles, /#protected-section,\n#today-summary/);
});
