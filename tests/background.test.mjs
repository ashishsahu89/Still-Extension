import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const backgroundCode = await readFile(
  new URL("../background.js", import.meta.url),
  "utf8"
);

function extensionEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    }
  };
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createHarness({ initialState = {}, tabs = [], initialNow = 1_800_000_000_000 } = {}) {
  let now = initialNow;
  const state = clone(initialState);
  const updates = [];
  const alarms = new Map();
  const notifications = new Map();
  const badge = { text: "", color: "" };
  const events = {
    installed: extensionEvent(),
    startup: extensionEvent(),
    alarm: extensionEvent(),
    message: extensionEvent(),
    beforeNavigate: extensionEvent(),
    historyStateUpdated: extensionEvent(),
    storageChanged: extensionEvent(),
    notificationButtonClicked: extensionEvent()
  };

  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }

    static now() {
      return now;
    }
  }

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: clone(state[keys]) };
          if (!keys) return clone(state);
          return Object.fromEntries(keys.map((key) => [key, clone(state[key])]));
        },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = {
              oldValue: clone(state[key]),
              newValue: clone(value)
            };
          }
          Object.assign(state, clone(values));
          for (const listener of events.storageChanged.listeners) {
            listener(changes, "local");
          }
        }
      },
      onChanged: events.storageChanged
    },
    runtime: {
      onInstalled: events.installed,
      onStartup: events.startup,
      onMessage: events.message,
      getURL(path) {
        return `chrome-extension://still/${path}`;
      }
    },
    webNavigation: {
      onBeforeNavigate: events.beforeNavigate,
      onHistoryStateUpdated: events.historyStateUpdated
    },
    alarms: {
      onAlarm: events.alarm,
      create(name, details) {
        alarms.set(name, clone(details));
      },
      async clear(name) {
        return alarms.delete(name);
      },
      async getAll() {
        return Array.from(alarms, ([name, details]) => ({
          name,
          ...clone(details)
        }));
      }
    },
    notifications: {
      onButtonClicked: events.notificationButtonClicked,
      async create(id, options) {
        notifications.set(id, clone(options));
        return id;
      },
      async clear(id) {
        return notifications.delete(id);
      }
    },
    tabs: {
      async query() {
        return clone(tabs);
      },
      async update(tabId, details) {
        updates.push({ tabId, ...clone(details) });
        const tab = tabs.find((item) => item.id === tabId);
        if (tab && details.url) tab.url = details.url;
        return clone(tab);
      }
    },
    action: {
      async setBadgeBackgroundColor({ color }) {
        badge.color = color;
      },
      async setBadgeText({ text }) {
        badge.text = text;
      }
    }
  };

  vm.runInNewContext(backgroundCode, {
    chrome,
    Date: FakeDate,
    URL,
    Map,
    Object,
    Promise,
    String,
    Number,
    Math,
    setTimeout() {
      return 0;
    }
  });

  async function send(message, sender = {}) {
    let response;
    events.message.listeners[0](message, sender, (value) => {
      response = value;
    });
    for (let attempt = 0; response === undefined && attempt < 20; attempt += 1) {
      await settle();
    }
    return response;
  }

  return {
    alarms,
    badge,
    events,
    notifications,
    send,
    setNow(value) {
      now = value;
    },
    state,
    updates
  };
}

const defaultSites = [
  { host: "youtube.com", label: "YouTube", enabled: true },
  { host: "instagram.com", label: "Instagram", enabled: true },
  { host: "reddit.com", label: "Reddit", enabled: true }
];

function baseState(overrides = {}) {
  return {
    protectedSites: clone(defaultSites),
    mindfulMode: true,
    pauseSeconds: 8,
    strictFocus: true,
    focus: null,
    passes: {},
    passStarts: {},
    stats: {},
    siteStats: {},
    impulseEvents: [],
    focusSessions: [],
    intentions: [],
    focusExits: [],
    routines: [],
    routineSkips: {},
    activeRoutine: null,
    dismissedRoutineSuggestions: {},
    ...overrides
  };
}

function localTimestamp(year, month, day, hour, minute) {
  return new Date(year, month, day, hour, minute, 0, 0).getTime();
}

function routine(overrides = {}) {
  return {
    id: "deep-work",
    name: "Deep work",
    days: [1],
    startTime: "09:00",
    endTime: "11:00",
    mode: "strict",
    startBehavior: "automatic",
    topic: "Write the brief",
    siteHosts: ["youtube.com", "reddit.com"],
    enabled: true,
    ...overrides
  };
}

test("starting strict focus snapshots protection, clears passes, and redirects open protected tabs", async () => {
  const now = 1_800_000_000_000;
  const harness = createHarness({
    initialNow: now,
    initialState: baseState({ passes: { "youtube.com": now + 60_000 } }),
    tabs: [
      { id: 1, url: "https://www.youtube.com/watch?v=1" },
      { id: 2, url: "https://reddit.com/r/productivity" },
      { id: 3, url: "https://example.com/" }
    ]
  });
  await settle();

  const response = await harness.send({
    type: "START_FOCUS",
    minutes: 25,
    intention: "Write tests"
  });

  assert.equal(response.ok, true);
  assert.equal(harness.state.focus.strict, true);
  assert.deepEqual(
    Array.from(harness.state.focus.protectedSites, (site) => site.host),
    ["youtube.com", "instagram.com", "reddit.com"]
  );
  assert.deepEqual(harness.state.passes, {});
  assert.equal(harness.alarms.has("pass:youtube.com"), false);
  assert.equal(harness.alarms.get("focus-complete").when, now + 25 * 60_000);
  assert.deepEqual(
    harness.updates.map((update) => update.tabId).sort(),
    [1, 2]
  );
  assert.ok(harness.updates.every((update) => update.url.includes("focus=true")));
  assert.ok(harness.updates.every((update) => update.url.includes("strict=true")));
});

test("strict exit is background-enforced and records partial progress", async () => {
  const now = 1_800_000_000_000;
  const harness = createHarness({
    initialNow: now,
    initialState: baseState()
  });
  await settle();
  await harness.send({ type: "START_FOCUS", minutes: 25, intention: "Deep work" });

  const directStop = await harness.send({
    type: "STOP_FOCUS",
    reason: "Distracted"
  });
  assert.equal(directStop.ok, false);
  assert.equal(directStop.reason, "cooldown-active");

  const request = await harness.send({ type: "REQUEST_FOCUS_EXIT" });
  assert.equal(request.unlockAt, now + 20_000);

  harness.setNow(now + 19_000);
  const earlyStop = await harness.send({
    type: "STOP_FOCUS",
    reason: "A real interruption"
  });
  assert.equal(earlyStop.ok, false);

  harness.setNow(now + 21_000);
  const stopped = await harness.send({
    type: "STOP_FOCUS",
    reason: "A real interruption"
  });
  assert.equal(stopped.ok, true);
  assert.equal(harness.state.focus, null);
  const day = Object.values(harness.state.stats)[0];
  assert.equal(day.focusedSeconds, 21);
  assert.equal(day.sessions, 1);
  assert.equal(day.interruptedSessions, 1);
  assert.equal(harness.state.focusExits[0].reason, "A real interruption");
  assert.equal(harness.state.focusExits[0].elapsedSeconds, 21);
  assert.equal(harness.state.focusSessions[0].focusedSeconds, 21);
  assert.equal(harness.state.focusSessions[0].completed, false);
  assert.equal(harness.state.focusSessions[0].intention, "Deep work");
});

test("confirmed emergency exit remains immediately available", async () => {
  const now = 1_800_000_000_000;
  const harness = createHarness({
    initialNow: now,
    initialState: baseState()
  });
  await settle();
  await harness.send({ type: "START_FOCUS", minutes: 25, intention: "Deep work" });

  const unconfirmed = await harness.send({
    type: "STOP_FOCUS",
    emergency: true
  });
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.reason, "emergency-confirmation-required");

  harness.setNow(now + 5_000);
  const confirmed = await harness.send({
    type: "STOP_FOCUS",
    emergency: true,
    confirmed: true,
    reason: "Urgent call"
  });
  assert.equal(confirmed.ok, true);
  assert.equal(harness.state.focusExits[0].emergency, true);
  assert.equal(harness.state.focusExits[0].reason, "Urgent call");
});

test("history-state navigation is blocked using the session snapshot", async () => {
  const now = 1_800_000_000_000;
  const harness = createHarness({
    initialNow: now,
    initialState: baseState({
      protectedSites: [
        { host: "youtube.com", label: "YouTube", enabled: false }
      ],
      focus: {
        startedAt: now - 60_000,
        endAt: now + 20 * 60_000,
        minutes: 21,
        intention: "Plan",
        strict: true,
        protectedSites: [{ host: "youtube.com", label: "YouTube" }]
      }
    })
  });
  await settle();

  await eventsCall(harness.events.historyStateUpdated, {
    frameId: 0,
    tabId: 7,
    url: "https://www.youtube.com/shorts/abc"
  });

  assert.equal(harness.updates.length, 1);
  assert.equal(harness.updates[0].tabId, 7);
  assert.ok(harness.updates[0].url.includes("focus=true"));
});

test("startup completes an expired focus and restores active alarms", async () => {
  const now = 1_800_000_000_000;
  const expired = createHarness({
    initialNow: now,
    initialState: baseState({
      focus: {
        startedAt: now - 30 * 60_000,
        endAt: now - 5 * 60_000,
        minutes: 25,
        intention: "Expired session"
      }
    })
  });
  await settle();
  assert.equal(expired.state.focus, null);
  assert.equal(Object.values(expired.state.stats)[0].focusedMinutes, 25);
  assert.equal(expired.badge.text, "");

  const active = createHarness({
    initialNow: now,
    initialState: baseState({
      focus: {
        startedAt: now - 5 * 60_000,
        endAt: now + 20 * 60_000,
        minutes: 25,
        intention: "Restored session"
      }
    })
  });
  await settle();
  assert.equal(active.state.focus.strict, true);
  assert.equal(active.state.focus.protectedSites.length, 3);
  assert.equal(active.alarms.get("focus-complete").when, now + 20 * 60_000);
  assert.equal(active.badge.text, "20");
});

test("startup clears an expired pass even if its site was disabled", async () => {
  const now = 1_800_000_000_000;
  const harness = createHarness({
    initialNow: now,
    initialState: baseState({
      protectedSites: [
        { host: "youtube.com", label: "YouTube", enabled: false }
      ],
      passes: { "youtube.com": now - 1 }
    })
  });
  await settle();

  assert.deepEqual(harness.state.passes, {});
  assert.equal(harness.alarms.has("pass:youtube.com"), false);
});

test("an intercepted impulse is recorded in aggregate, by site, and by time", async () => {
  const now = 1_800_000_000_000;
  const harness = createHarness({
    initialNow: now,
    initialState: baseState()
  });
  await settle();

  await eventsCall(harness.events.beforeNavigate, {
    frameId: 0,
    tabId: 9,
    url: "https://www.youtube.com/watch?v=focus"
  });

  const day = Object.values(harness.state.stats)[0];
  const siteDay = Object.values(harness.state.siteStats)[0];
  assert.equal(day.impulsesPaused, 1);
  assert.equal(siteDay["youtube.com"].impulses, 1);
  assert.equal(siteDay["youtube.com"].usageSeconds, 0);
  assert.deepEqual(
    { ...harness.state.impulseEvents[0] },
    { host: "youtube.com", createdAt: now }
  );
});

test("temporary access records protected-site usage when the pass ends", async () => {
  const now = 1_800_000_000_000;
  const harness = createHarness({
    initialNow: now,
    initialState: baseState(),
    tabs: [{ id: 11, url: "https://youtube.com/watch?v=focus" }]
  });
  await settle();

  const allowed = await harness.send({
    type: "ALLOW_SITE",
    host: "youtube.com",
    intention: "Watch the tutorial"
  });
  assert.equal(allowed.endAt, now + 5 * 60_000);
  assert.equal(harness.state.passStarts["youtube.com"], now);

  harness.setNow(now + 2 * 60_000);
  const expired = await harness.send(
    { type: "PASS_EXPIRED", host: "youtube.com", force: true },
    { tab: { id: 11, url: "https://youtube.com/watch?v=focus" } }
  );

  assert.equal(expired.ok, true);
  assert.deepEqual(harness.state.passes, {});
  assert.deepEqual(harness.state.passStarts, {});
  const siteDay = Object.values(harness.state.siteStats)[0];
  assert.equal(siteDay["youtube.com"].usageSeconds, 120);
});

test("an automatic strict routine starts only the remaining scheduled time", async () => {
  const now = localTimestamp(2027, 0, 4, 9, 30);
  const harness = createHarness({
    initialNow: now,
    initialState: baseState({ routines: [routine()] })
  });
  await settle();
  await settle();

  assert.equal(harness.state.focus.source, "routine");
  assert.equal(harness.state.focus.routineId, "deep-work");
  assert.equal(harness.state.focus.startedAt, now);
  assert.equal(harness.state.focus.endAt, localTimestamp(2027, 0, 4, 11, 0));
  assert.deepEqual(
    Array.from(harness.state.focus.protectedSites, (site) => site.host),
    ["youtube.com", "reddit.com"]
  );
});

test("ask-first routines notify without starting and Start now uses the scheduled end", async () => {
  const startAt = localTimestamp(2027, 0, 4, 9, 0);
  const now = localTimestamp(2027, 0, 4, 8, 55);
  const harness = createHarness({
    initialNow: now,
    initialState: baseState({
      routines: [routine({ startBehavior: "ask" })]
    })
  });
  await settle();

  const notificationId = `routine:start:deep-work:${startAt}`;
  await eventsCall(harness.events.alarm, {
    name: `routine:pre:deep-work:${startAt}`
  });
  assert.equal(harness.state.focus, null);
  assert.equal(harness.notifications.has(notificationId), true);

  await eventsCall(harness.events.notificationButtonClicked, notificationId, 0);
  assert.equal(harness.state.focus.source, "routine");
  assert.equal(harness.state.focus.startedAt, now);
  assert.equal(harness.state.focus.endAt, localTimestamp(2027, 0, 4, 11, 0));
});

test("Skip today suppresses the occurrence but preserves future routines", async () => {
  const startAt = localTimestamp(2027, 0, 4, 9, 0);
  const now = localTimestamp(2027, 0, 4, 8, 55);
  const harness = createHarness({
    initialNow: now,
    initialState: baseState({ routines: [routine()] })
  });
  await settle();
  const notificationId = `routine:start:deep-work:${startAt}`;
  await eventsCall(harness.events.alarm, {
    name: `routine:pre:deep-work:${startAt}`
  });
  await eventsCall(harness.events.notificationButtonClicked, notificationId, 1);
  harness.setNow(startAt);
  await eventsCall(harness.events.alarm, {
    name: `routine:start:deep-work:${startAt}`
  });

  assert.equal(harness.state.focus, null);
  assert.equal(harness.state.routineSkips[`deep-work:${startAt}`], true);
  assert.equal(harness.state.routines[0].enabled, true);
});

test("an automatic routine never replaces an active manual focus session", async () => {
  const now = localTimestamp(2027, 0, 4, 9, 30);
  const manualFocus = {
    startedAt: now - 10 * 60_000,
    endAt: now + 20 * 60_000,
    minutes: 30,
    intention: "Manual work",
    strict: true,
    source: "manual",
    protectedSites: [{ host: "youtube.com", label: "YouTube" }]
  };
  const harness = createHarness({
    initialNow: now,
    initialState: baseState({
      focus: manualFocus,
      routines: [routine()]
    })
  });
  await settle();
  await settle();

  assert.equal(harness.state.focus.intention, "Manual work");
  assert.equal(harness.state.focus.source, "manual");
  assert.equal(harness.state.focus.routineId, undefined);
});

test("a mindful routine protects its selected sites even when global pauses are off", async () => {
  const now = localTimestamp(2027, 0, 4, 9, 30);
  const startAt = localTimestamp(2027, 0, 4, 9, 0);
  const harness = createHarness({
    initialNow: now,
    initialState: baseState({
      mindfulMode: false,
      routines: [
        routine({
          mode: "mindful",
          siteHosts: ["reddit.com"]
        })
      ]
    })
  });
  await settle();
  await settle();

  assert.equal(harness.state.focus, null);
  assert.equal(harness.state.activeRoutine.routineId, "deep-work");
  await eventsCall(harness.events.beforeNavigate, {
    frameId: 0,
    tabId: 14,
    url: "https://reddit.com/r/productivity"
  });
  assert.equal(harness.updates.length, 1);

  harness.setNow(localTimestamp(2027, 0, 4, 11, 0));
  await eventsCall(harness.events.alarm, {
    name: `routine:end:deep-work:${startAt}`
  });
  assert.equal(harness.state.activeRoutine, null);
});

test("emergency exit from an automatic routine skips only its current occurrence", async () => {
  const now = localTimestamp(2027, 0, 4, 9, 30);
  const startAt = localTimestamp(2027, 0, 4, 9, 0);
  const harness = createHarness({
    initialNow: now,
    initialState: baseState({ routines: [routine()] })
  });
  await settle();
  await settle();
  assert.equal(harness.state.focus.source, "routine");

  const stopped = await harness.send({
    type: "STOP_FOCUS",
    emergency: true,
    confirmed: true,
    reason: "Urgent interruption"
  });
  await settle();

  assert.equal(stopped.ok, true);
  assert.equal(harness.state.focus, null);
  assert.equal(harness.state.routineSkips[`deep-work:${startAt}`], true);
  assert.equal(harness.state.routines[0].enabled, true);
});

async function eventsCall(event, ...args) {
  await event.listeners[0](...args);
  await settle();
}
