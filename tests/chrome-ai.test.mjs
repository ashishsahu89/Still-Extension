import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const adapterCode = await readFile(
  new URL("../chrome-ai.js", import.meta.url),
  "utf8"
);

function loadAdapter(LanguageModel, { active = true } = {}) {
  const context = {
    globalThis: {},
    navigator: { userActivation: { isActive: active } },
    TypeError
  };
  context.globalThis.LanguageModel = LanguageModel;
  context.globalThis.navigator = context.navigator;
  vm.runInNewContext(adapterCode, context);
  return context.globalThis.StillChromeAI;
}

function fakeModel({
  availability = "available",
  responses = [],
  onCreate,
  onPrompt,
  onDestroy
} = {}) {
  return {
    async availability(options) {
      assert.deepEqual(
        JSON.parse(JSON.stringify(options.expectedInputs)),
        [{ type: "text", languages: ["en"] }]
      );
      return availability;
    },
    async create(options) {
      onCreate?.(options);
      return {
        async prompt(prompt, promptOptions) {
          onPrompt?.(prompt, promptOptions);
          const response = responses.shift();
          if (response instanceof Error) throw response;
          return response ?? "";
        },
        async destroy() {
          onDestroy?.();
        }
      };
    }
  };
}

test("reports unsupported without the LanguageModel API", async () => {
  const adapter = loadAdapter(undefined);
  const result = await adapter.getAvailability();
  assert.equal(result.supported, false);
  assert.equal(result.state, "unsupported");
});

test("reports all recognized Chrome availability states", async () => {
  for (const state of ["unavailable", "downloadable", "downloading", "available"]) {
    const adapter = loadAdapter(fakeModel({ availability: state }));
    const result = await adapter.getAvailability();
    assert.equal(result.supported, true);
    assert.equal(result.state, state);
  }
});

test("requires a direct user action before creating or downloading a session", async () => {
  let createCount = 0;
  const adapter = loadAdapter(
    fakeModel({ onCreate: () => { createCount += 1; } }),
    { active: false }
  );
  const result = await adapter.createSession({ userInitiated: true });
  assert.equal(result.ok, false);
  assert.equal(result.state, "user-action-required");
  assert.equal(createCount, 0);
});

test("reports model download progress from a user-initiated create", async () => {
  const progress = [];
  const adapter = loadAdapter(fakeModel({
    availability: "downloadable",
    onCreate(options) {
      options.monitor({
        addEventListener(type, handler) {
          assert.equal(type, "downloadprogress");
          handler({ loaded: 0.426 });
        }
      });
    }
  }));
  const result = await adapter.createSession({
    userInitiated: true,
    onDownloadProgress(value) {
      progress.push(value);
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(progress)), [
    { loaded: 0.426, percent: 43 }
  ]);
  await result.session.destroy();
});

test("classifies aggregated domains with structured output and destroys the session", async () => {
  let promptText = "";
  let promptOptions;
  let destroyed = 0;
  const adapter = loadAdapter(fakeModel({
    responses: [
      JSON.stringify({
        classifications: [
          { domain: "youtube.com", category: "Video", confidence: 0.96 },
          { domain: "reddit.com", category: "Social", confidence: 0.7 }
        ]
      })
    ],
    onPrompt(prompt, options) {
      promptText = prompt;
      promptOptions = options;
    },
    onDestroy() {
      destroyed += 1;
    }
  }));

  const result = await adapter.classifyDomains(
    [
      {
        domain: "https://youtube.com/watch?v=private",
        activeSeconds: 999,
        title: "Private title"
      },
      {
        domain: "youtube.com",
        activeSeconds: 120,
        sessionCount: 2,
        dayparts: { evening: 120 }
      },
      {
        host: "reddit.com",
        durationSeconds: 30,
        sessions: 1,
        dayparts: { afternoon: 30 },
        path: "/r/private"
      }
    ],
    { userInitiated: true }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.suggestions)), [
    { domain: "youtube.com", category: "Video", confidence: 0.96 },
    { domain: "reddit.com", category: "Social", confidence: 0.7 }
  ]);
  assert.equal(typeof promptOptions.responseConstraint, "object");
  assert.match(promptText, /"activeSeconds":120/);
  assert.doesNotMatch(promptText, /Private title|private|watch\?/);
  assert.equal(destroyed, 1);
});

test("defaults invalid and missing category suggestions to Other", async () => {
  const adapter = loadAdapter(fakeModel({
    responses: [
      JSON.stringify({
        classifications: [
          { domain: "youtube.com", category: "Learning-ish", confidence: 0.99 },
          { domain: "evil.example", category: "Finance", confidence: 1 },
          { domain: "reddit.com", category: "Social", confidence: 7 }
        ]
      })
    ]
  }));
  const result = await adapter.classifyDomains(
    ["youtube.com", "reddit.com", "github.com"],
    { userInitiated: true }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.suggestions)), [
    { domain: "youtube.com", category: "Other", confidence: 0 },
    { domain: "reddit.com", category: "Other", confidence: 0 },
    { domain: "github.com", category: "Other", confidence: 0 }
  ]);
});

test("returns safe Other suggestions for unreadable JSON", async () => {
  const adapter = loadAdapter(fakeModel({ responses: ["not json"] }));
  const result = await adapter.classifyDomains(
    ["youtube.com"],
    { userInitiated: true }
  );
  assert.equal(result.ok, false);
  assert.equal(result.state, "error");
  assert.deepEqual(JSON.parse(JSON.stringify(result.suggestions)), [
    { domain: "youtube.com", category: "Other", confidence: 0 }
  ]);
});

test("falls back to validated JSON when responseConstraint is unsupported", async () => {
  const unsupported = new TypeError("responseConstraint is unsupported");
  const adapter = loadAdapter(fakeModel({
    responses: [
      unsupported,
      JSON.stringify({
        classifications: [
          { domain: "news.example", category: "News", confidence: 0.8 }
        ]
      })
    ]
  }));
  const result = await adapter.classifyDomains(
    ["news.example"],
    { userInitiated: true }
  );
  assert.equal(result.ok, true);
  assert.equal(result.suggestions[0].category, "News");
});

test("explains only sanitized aggregated data, trims output, and destroys its session", async () => {
  let promptText = "";
  let destroyed = 0;
  const longInsight =
    "  **Video use was concentrated in the evening, across a limited sample.** " +
    "This extra sentence is intentionally long so the adapter safely trims model output without asking the model to hit a brittle exact character limit. ".repeat(3);
  const adapter = loadAdapter(fakeModel({
    responses: [longInsight],
    onPrompt(prompt) {
      promptText = prompt;
    },
    onDestroy() {
      destroyed += 1;
    }
  }));
  const result = await adapter.explainInsights(
    {
      rangeDays: 7,
      totalActiveSeconds: 3600,
      totalSessions: 4,
      title: "Never send this",
      urls: ["https://private.example/path"],
      domains: [
        {
          domain: "youtube.com",
          activeSeconds: 3600,
          sessionCount: 4,
          category: "Video",
          path: "/watch/private"
        }
      ]
    },
    { userInitiated: true }
  );

  assert.equal(result.ok, true);
  assert.ok(result.insight.length <= 240);
  assert.doesNotMatch(result.insight, /[*_#>`]/);
  assert.doesNotMatch(promptText, /Never send this|private\.example|watch\/private/);
  assert.match(promptText, /youtube\.com/);
  assert.equal(destroyed, 1);
});

test("returns graceful explanation errors and still destroys the session", async () => {
  let destroyed = 0;
  const adapter = loadAdapter(fakeModel({
    responses: [new Error("model stopped")],
    onDestroy() {
      destroyed += 1;
    }
  }));
  const result = await adapter.explainInsights(
    { totalSessions: 2 },
    { userInitiated: true }
  );
  assert.equal(result.ok, false);
  assert.equal(result.state, "error");
  assert.equal(result.insight, "");
  assert.match(result.error, /model stopped/);
  assert.equal(destroyed, 1);
});
