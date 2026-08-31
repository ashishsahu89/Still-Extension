import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../tab-organizer.js", import.meta.url), "utf8");
const sandbox = { URL };
vm.runInNewContext(source, sandbox);
const organizer = sandbox.StillTabOrganizer;

function tab(id, url) {
  return { id, groupId: -1, url, title: "Tab" };
}

test("names app subdomains from the main domain without AI", () => {
  assert.equal(organizer.nameForTabs([tab(1, "https://app.glean.com/")]), "Glean");
  assert.equal(organizer.nameForTabs([tab(1, "https://login.salesforce.com/")]), "Salesforce");
});

test("keeps meaningful subdomains while using the main domain as context", () => {
  assert.equal(
    organizer.nameForTabs([tab(1, "https://success.planview.com/")]),
    "Planview · Success"
  );
  assert.equal(
    organizer.nameForTabs([tab(1, "https://planview.my.salesforce.com/")]),
    "Salesforce · Planview"
  );
  assert.equal(
    organizer.nameForTabs([tab(1, "https://planview.leankit.com/")]),
    "LeanKit · Planview"
  );
});

test("keeps separate subdomains in separate groups with distinct names", () => {
  const plans = organizer.plansForTabs([
    tab(1, "https://planview.my.salesforce.com/one"),
    tab(2, "https://planview.my.salesforce.com/two"),
    tab(3, "https://planview.leankit.com/one"),
    tab(4, "https://planview.leankit.com/two")
  ]);

  assert.deepEqual(
    Array.from(plans, (plan) => plan.title),
    ["Salesforce · Planview", "LeanKit · Planview"]
  );
});

test("adds recognizable emoji only to deterministic cross-site category groups", () => {
  const cases = [
    ["📰 News", "https://theguardian.com/", "https://reuters.com/"],
    ["🛍️ Shopping", "https://amazon.com/", "https://etsy.com/"],
    ["💬 Social", "https://reddit.com/", "https://x.com/"],
    ["🎬 Video", "https://youtube.com/", "https://vimeo.com/"]
  ];

  for (const [expected, firstUrl, secondUrl] of cases) {
    assert.equal(
      organizer.nameForTabs([tab(1, firstUrl), tab(2, secondUrl)]),
      expected
    );
  }

  assert.equal(
    organizer.nameForLinkedTabs([
      tab(1, "https://youtube.com/watch?v=one"),
      tab(2, "https://youtube.com/watch?v=two")
    ], "youtube.com"),
    "🔗 YouTube"
  );
});
