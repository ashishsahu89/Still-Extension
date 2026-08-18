import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

await import("../site-categories.js");

const {
  TAXONOMY,
  normalizeHost,
  categorizeHost,
  aggregateCategoryInsights,
  topWebsites
} = globalThis.StillSiteCategories;

beforeEach(() => {
  assert.ok(globalThis.StillSiteCategories);
});

test("exports a small, stable focus-insights taxonomy", () => {
  assert.deepEqual(TAXONOMY, [
    "Social",
    "Video",
    "News",
    "Entertainment",
    "Communication",
    "Productivity",
    "Shopping",
    "Reference & learning",
    "Finance",
    "Other"
  ]);
});

test("normalizes URLs, casing, ports, and the www prefix", () => {
  assert.equal(normalizeHost(" HTTPS://WWW.YouTube.com:443/watch?v=1 "), "youtube.com");
  assert.equal(normalizeHost("www.reddit.com/r/focus"), "reddit.com");
  assert.equal(normalizeHost("news.bbc.co.uk"), "news.bbc.co.uk");
  assert.equal(normalizeHost(null), "");
});

test("categorizes curated hosts and their subdomains", () => {
  assert.equal(categorizeHost("m.youtube.com"), "Video");
  assert.equal(categorizeHost("old.reddit.com"), "Social");
  assert.equal(categorizeHost("news.bbc.co.uk"), "News");
  assert.equal(categorizeHost("docs.google.com"), "Productivity");
  assert.equal(categorizeHost("stackoverflow.com"), "Reference & learning");
});

test("uses conservative heuristics and defaults unknown sites to Other", () => {
  assert.equal(categorizeHost("daily.news.example"), "News");
  assert.equal(categorizeHost("learn.example.edu"), "Reference & learning");
  assert.equal(categorizeHost("examplesocialinside.com"), "Other");
  assert.equal(categorizeHost("quiet-unknown.example"), "Other");
});

test("allows explicit overrides and cached AI categories without requiring AI", () => {
  assert.equal(
    categorizeHost("example.com", {
      overrides: { "example.com": "Productivity" },
      cachedCategories: { "example.com": "Shopping" }
    }),
    "Productivity"
  );
  assert.equal(
    categorizeHost("sub.example.com", {
      cachedCategories: new Map([["example.com", "Communication"]])
    }),
    "Communication"
  );
  assert.equal(
    categorizeHost("example.com", { overrides: { "example.com": "Sensitive" } }),
    "Other"
  );
});

test("aggregates daily usage by category with sorted domain leaders", () => {
  const result = aggregateCategoryInsights({
    usageStats: {
      "2026-07-20": {
        "youtube.com": { usageSeconds: 600, visits: 2, sessions: 2 },
        "vimeo.com": { usageSeconds: 120, visits: 1, sessions: 1 },
        "reddit.com": { usageSeconds: 300, visits: 3, sessions: 2 }
      },
      "2026-07-21": {
        "m.youtube.com": { usageSeconds: 180, visits: 1, sessions: 1 },
        "unknown.example": { usageSeconds: 60 }
      }
    },
    rangeStart: new Date(2026, 6, 20).getTime(),
    rangeEnd: new Date(2026, 6, 22).getTime()
  });

  assert.equal(result.totalSeconds, 1260);
  assert.deepEqual(
    result.categories.map(({ category, seconds }) => ({ category, seconds })),
    [
      { category: "Video", seconds: 900 },
      { category: "Social", seconds: 300 },
      { category: "Other", seconds: 60 }
    ]
  );
  assert.equal(result.categories[0].percent, 71.4);
  assert.deepEqual(
    result.categories[0].domains.map(({ host, seconds }) => ({ host, seconds })),
    [
      { host: "youtube.com", seconds: 600 },
      { host: "m.youtube.com", seconds: 180 },
      { host: "vimeo.com", seconds: 120 }
    ]
  );
  assert.equal(result.categories[0].visits, 4);
  assert.equal(result.categories[0].sessions, 4);
  assert.equal(result.categories[2].visits, undefined);
});

test("aggregates occurrence data and filters by timestamp range", () => {
  const result = aggregateCategoryInsights({
    usageStats: [
      {
        domain: "youtube.com",
        startedAt: 2_000,
        endedAt: 12_000
      },
      {
        host: "reddit.com",
        startedAt: 20_000,
        durationSeconds: 20
      },
      {
        host: "netflix.com",
        startedAt: 50_000,
        durationSeconds: 99
      }
    ],
    rangeStart: 1_000,
    rangeEnd: 40_000
  });

  assert.equal(result.totalSeconds, 30);
  assert.deepEqual(
    result.categories.map(({ category, seconds, visits, sessions }) => ({
      category,
      seconds,
      visits,
      sessions
    })),
    [
      { category: "Social", seconds: 20, visits: 1, sessions: 1 },
      { category: "Video", seconds: 10, visits: 1, sessions: 1 }
    ]
  );
});

test("applies category overrides during aggregation", () => {
  const result = aggregateCategoryInsights({
    usageStats: {
      "custom.example": { usageSeconds: 90, visits: 2 }
    },
    overrides: { "custom.example": "Productivity" }
  });

  assert.equal(result.categories[0].category, "Productivity");
  assert.equal(result.categories[0].seconds, 90);
  assert.equal(result.categories[0].visits, 2);
});

test("returns only the ten most-used websites across categories", () => {
  const usageStats = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      `site-${String(index).padStart(2, "0")}.example`,
      { usageSeconds: (index + 1) * 60 }
    ])
  );
  const insights = aggregateCategoryInsights({ usageStats });
  const websites = topWebsites(insights);

  assert.equal(websites.length, 10);
  assert.equal(websites[0].host, "site-11.example");
  assert.equal(websites[0].seconds, 720);
  assert.equal(websites.at(-1).host, "site-02.example");
  assert.ok(websites.every((website, index) =>
    index === 0 || websites[index - 1].seconds >= website.seconds
  ));
});
