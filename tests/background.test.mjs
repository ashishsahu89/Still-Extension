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
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function createHarness({
  initialState = {},
  tabs = [],
  initialNow = 1_800_000_000_000,
  initialFocusedWindowId = 1,
  initialIdleState = "active"
} = {}) {
  let now = initialNow;
  let focusedWindowId = initialFocusedWindowId;
  let idleState = initialIdleState;
  const tabState = clone(tabs);
  const state = clone(initialState);
  const updates = [];
  const alarms = new Map();
  const notifications = new Map();
  const dynamicRules = new Map();
  const registeredScripts = new Map();
  const badge = { text: "", color: "" };
  const events = {
    installed: extensionEvent(),
    startup: extensionEvent(),
    alarm: extensionEvent(),
    message: extensionEvent(),
    beforeNavigate: extensionEvent(),
    historyStateUpdated: extensionEvent(),
    storageChanged: extensionEvent(),
    notificationButtonClicked: extensionEvent(),
    tabActivated: extensionEvent(),
    tabUpdated: extensionEvent(),
    tabRemoved: extensionEvent(),
    windowFocusChanged: extensionEvent(),
    idleStateChanged: extensionEvent()
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
      id: "still",
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
      onActivated: events.tabActivated,
      onUpdated: events.tabUpdated,
      onRemoved: events.tabRemoved,
      async query(queryInfo = {}) {
        return clone(
          tabState.filter(
            (tab) =>
              (queryInfo.active === undefined || tab.active === queryInfo.active) &&
              (queryInfo.windowId === undefined ||
                (tab.windowId ?? 1) === queryInfo.windowId)
          )
        );
      },
      async get(tabId) {
        return clone(tabState.find((tab) => tab.id === tabId));
      },
      async update(tabId, details) {
        updates.push({ tabId, ...clone(details) });
        const tab = tabState.find((item) => item.id === tabId);
        if (tab && details.url) tab.url = details.url;
        return clone(tab);
      }
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: events.windowFocusChanged,
      async getLastFocused() {
        return {
          id: focusedWindowId,
          focused: focusedWindowId !== -1
        };
      }
    },
    idle: {
      onStateChanged: events.idleStateChanged,
      async queryState() {
        return idleState;
      }
    },
    declarativeNetRequest: {
      async getDynamicRules() {
        return clone(Array.from(dynamicRules.values()));
      },
      async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
        for (const id of removeRuleIds) dynamicRules.delete(id);
        for (const rule of addRules) dynamicRules.set(rule.id, clone(rule));
      }
    },
    scripting: {
      async getRegisteredContentScripts() {
        return clone(Array.from(registeredScripts.values()));
      },
      async unregisterContentScripts({ ids } = {}) {
        if (!ids) {
          registeredScripts.clear();
          return;
        }
        for (const id of ids) registeredScripts.delete(id);
      },
      async registerContentScripts(scripts) {
        for (const script of scripts) registeredScripts.set(script.id, clone(script));
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
    console: {
      error() {}
    },
    setTimeout() {
      return 0;
    }
  });

  function defaultSender(message) {
    if (["ALLOW_SITE", "CLEAR_STALE_STRICT_RULES"].includes(message?.type)) {
      return {
        id: chrome.runtime.id,
        url: chrome.runtime.getURL("intervention.html")
      };
    }
    return {
      id: chrome.runtime.id,
      url: chrome.runtime.getURL("popup.html")
    };
  }

  async function send(message, sender = defaultSender(message)) {
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
    dynamicRules,
    events,
    notifications,
    registeredScripts,
    send,
    activateTab(tabId) {
      const selected = tabState.find((tab) => tab.id === tabId);
      if (!selected) return;
      for (const tab of tabState) {
        if ((tab.windowId ?? 1) === (selected.windowId ?? 1)) {
          tab.active = tab.id === tabId;
        }
      }
    },
    removeTab(tabId) {
      const index = tabState.findIndex((tab) => tab.id === tabId);
      if (index >= 0) tabState.splice(index, 1);
    },
    setFocusedWindowId(value) {
      focusedWindowId = value;
    },
    setIdleState(value) {
      idleState = value;
    },
    setNow(value) {
      now = value;
    },
    setTabUrl(tabId, url) {
      const tab = tabState.find((item) => item.id === tabId);
      if (tab) tab.url = url;
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
    usageStats: {},
    usageEvents: [],
    usageTracker: null,
    usageTrackingEnabled: true,
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
  const strictRule = harness.dynamicRules.get(10001);
  assert.deepEqual(strictRule.condition.requestDomains, [
    "youtube.com",
    "instagram.com",
    "reddit.com"
  ]);
  assert.equal(strictRule.action.type, "redirect");
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
  assert.equal(harness.dynamicRules.size, 0);
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

test("strict focus uses a preventive rule and still records history-state impulses", async () => {
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

  assert.equal(harness.updates.length, 0);
  assert.deepEqual(
    harness.dynamicRules.get(10001).condition.requestDomains,
    ["youtube.com"]
  );
  assert.equal(Object.values(harness.state.stats)[0].impulsesPaused, 1);
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

test("concurrent navigation events cannot overwrite each other's impulse data", async () => {
  const now = 1_800_000_000_000;
  const harness = createHarness({
    initialNow: now,
    initialState: baseState()
  });
  await settle();

  const listener = harness.events.beforeNavigate.listeners[0];
  listener({
    frameId: 0,
    tabId: 21,
    url: "https://youtube.com/watch?v=one"
  });
  listener({
    frameId: 0,
    tabId: 22,
    url: "https://reddit.com/r/productivity"
  });
  await settle();

  const day = Object.values(harness.state.stats)[0];
  const siteDay = Object.values(harness.state.siteStats)[0];
  assert.equal(day.impulsesPaused, 2);
  assert.equal(siteDay["youtube.com"].impulses, 1);
  assert.equal(siteDay["reddit.com"].impulses, 1);
  assert.equal(harness.state.impulseEvents.length, 2);
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
  assert.equal(harness.registeredScripts.size, 1);
  assert.deepEqual(
    Array.from(harness.registeredScripts.values())[0].matches,
    ["*://youtube.com/*", "*://*.youtube.com/*"]
  );

  harness.setNow(now + 2 * 60_000);
  const expired = await harness.send(
    { type: "PASS_EXPIRED", host: "youtube.com", force: true },
    {
      id: "still",
      url: "https://youtube.com/watch?v=focus",
      tab: { id: 11, url: "https://youtube.com/watch?v=focus" }
    }
  );

  assert.equal(expired.ok, true);
  assert.deepEqual(harness.state.passes, {});
  assert.deepEqual(harness.state.passStarts, {});
  assert.equal(harness.registeredScripts.size, 0);
  const siteDay = Object.values(harness.state.siteStats)[0];
  assert.equal(siteDay["youtube.com"].usageSeconds, 120);
});

test("temporary access works during a non-strict focus session", async () => {
  const now = 1_800_000_000_000;
  const harness = createHarness({
    initialNow: now,
    initialState: baseState({ strictFocus: false })
  });
  await settle();
  await harness.send({
    type: "START_FOCUS",
    minutes: 25,
    intention: "Watch the course"
  });

  await eventsCall(harness.events.beforeNavigate, {
    frameId: 0,
    tabId: 23,
    url: "https://youtube.com/watch?v=course"
  });
  assert.equal(harness.updates.length, 1);

  const allowed = await harness.send({
    type: "ALLOW_SITE",
    host: "youtube.com",
    intention: "Course lesson"
  });
  assert.equal(allowed.ok, true);
  assert.equal(harness.registeredScripts.size, 1);

  await eventsCall(harness.events.beforeNavigate, {
    frameId: 0,
    tabId: 24,
    url: "https://youtube.com/watch?v=course"
  });
  assert.equal(harness.updates.length, 1);
});

test("privileged messages reject untrusted senders", async () => {
  const harness = createHarness({
    initialState: baseState()
  });
  await settle();

  const start = await harness.send(
    { type: "START_FOCUS", minutes: 25, intention: "Do work" },
    { id: "still", url: "https://example.com/" }
  );
  assert.equal(start.ok, false);
  assert.equal(start.reason, "invalid-sender");
  assert.equal(harness.state.focus, null);

  const access = await harness.send(
    { type: "ALLOW_SITE", host: "youtube.com" },
    { id: "still", url: "chrome-extension://still/popup.html" }
  );
  assert.equal(access.ok, false);
  assert.equal(access.reason, "invalid-sender");
  assert.deepEqual(harness.state.passes, {});
});

test("duplicate focus-complete alarms record a session only once", async () => {
  const now = 1_800_000_000_000;
  const harness = createHarness({
    initialNow: now,
    initialState: baseState({
      focus: {
        startedAt: now - 25 * 60_000,
        endAt: now,
        minutes: 25,
        intention: "Finish once",
        strict: true,
        protectedSites: clone(defaultSites)
      }
    })
  });
  await settle();

  const alarmListener = harness.events.alarm.listeners[0];
  alarmListener({ name: "focus-complete" });
  alarmListener({ name: "focus-complete" });
  await settle();

  assert.equal(harness.state.focus, null);
  assert.equal(harness.state.focusSessions.length, 1);
  assert.equal(Object.values(harness.state.stats)[0].sessions, 1);
  assert.equal(harness.dynamicRules.size, 0);
});

test("startup migrates storage and prunes history outside retention limits", async () => {
  const now = 1_800_000_000_000;
  const oldDailyAt = now - 600 * 24 * 60 * 60_000;
  const recentDailyAt = now - 30 * 24 * 60 * 60_000;
  const oldRawAt = now - 100 * 24 * 60 * 60_000;
  const recentRawAt = now - 10 * 24 * 60 * 60_000;
  const oldDay = new Date(oldDailyAt).toLocaleDateString("en-CA");
  const recentDay = new Date(recentDailyAt).toLocaleDateString("en-CA");
  const harness = createHarness({
    initialNow: now,
    initialState: baseState({
      stats: {
        [oldDay]: { impulsesPaused: 4 },
        [recentDay]: { impulsesPaused: 2 }
      },
      siteStats: {
        [oldDay]: { "youtube.com": { impulses: 4, usageSeconds: 20 } },
        [recentDay]: { "youtube.com": { impulses: 2, usageSeconds: 10 } }
      },
      usageStats: {
        [oldDay]: { "youtube.com": { usageSeconds: 400 } },
        [recentDay]: { "reddit.com": { usageSeconds: 200 } }
      },
      usageEvents: [
        {
          host: "youtube.com",
          startedAt: oldRawAt - 1000,
          endedAt: oldRawAt,
          usageSeconds: 1
        },
        {
          host: "reddit.com",
          startedAt: recentRawAt - 2000,
          endedAt: recentRawAt,
          usageSeconds: 2
        }
      ],
      impulseEvents: [
        { host: "youtube.com", createdAt: oldRawAt },
        { host: "reddit.com", createdAt: recentRawAt }
      ],
      focusSessions: [
        { startedAt: oldDailyAt, focusedSeconds: 1200 },
        { startedAt: recentDailyAt, focusedSeconds: 1200 }
      ],
      focusExits: [
        { createdAt: oldRawAt, reason: "Old" },
        { createdAt: recentRawAt, reason: "Recent" }
      ]
    })
  });
  await settle();

  assert.equal(harness.state.storageSchemaVersion, 2);
  assert.deepEqual(Object.keys(harness.state.stats), [recentDay]);
  assert.deepEqual(Object.keys(harness.state.siteStats), [recentDay]);
  assert.deepEqual(Object.keys(harness.state.usageStats), [recentDay]);
  assert.equal(harness.state.usageEvents.length, 1);
  assert.equal(harness.state.usageEvents[0].host, "reddit.com");
  assert.deepEqual(harness.state.impulseEvents, [
    { host: "reddit.com", createdAt: recentRawAt }
  ]);
  assert.equal(harness.state.focusSessions.length, 1);
  assert.equal(harness.state.focusSessions[0].startedAt, recentDailyAt);
  assert.equal(harness.state.focusExits.length, 1);
  assert.equal(harness.state.focusExits[0].createdAt, recentRawAt);
});

test("active-tab usage follows tab switches and stops when the active tab is removed", async () => {
  const now = 1_800_000_000_000;
  const day = new Date(now).toLocaleDateString("en-CA");
  const harness = createHarness({
    initialNow: now,
    initialState: baseState(),
    tabs: [
      {
        id: 1,
        windowId: 1,
        active: true,
        url: "https://www.youtube.com/watch?v=private"
      },
      {
        id: 2,
        windowId: 1,
        active: false,
        url: "https://reddit.com/r/private"
      }
    ]
  });
  await settle();

  harness.setNow(now + 10_000);
  harness.activateTab(2);
  await eventsCall(harness.events.tabActivated, {
    tabId: 2,
    windowId: 1
  });

  assert.equal(
    harness.state.usageStats[day]["youtube.com"].usageSeconds,
    10
  );
  assert.deepEqual(harness.state.usageEvents[0], {
    host: "youtube.com",
    startedAt: now,
    endedAt: now + 10_000,
    usageSeconds: 10
  });
  assert.equal(harness.state.usageTracker.host, "reddit.com");

  harness.setNow(now + 30_000);
  harness.removeTab(2);
  await eventsCall(harness.events.tabRemoved, 2, {
    windowId: 1,
    isWindowClosing: false
  });
  assert.equal(harness.state.usageStats[day]["reddit.com"].usageSeconds, 20);
  assert.equal(harness.state.usageTracker, null);
});

test("active-tab usage pauses while Chrome is unfocused or the user is idle", async () => {
  const now = 1_800_000_000_000;
  const day = new Date(now).toLocaleDateString("en-CA");
  const harness = createHarness({
    initialNow: now,
    initialState: baseState(),
    tabs: [
      {
        id: 1,
        windowId: 1,
        active: true,
        url: "https://youtube.com/"
      }
    ]
  });
  await settle();

  harness.setNow(now + 12_000);
  harness.setFocusedWindowId(-1);
  await eventsCall(harness.events.windowFocusChanged, -1);
  harness.setNow(now + 42_000);
  harness.setFocusedWindowId(1);
  await eventsCall(harness.events.windowFocusChanged, 1);
  harness.setNow(now + 50_000);
  harness.setIdleState("idle");
  await eventsCall(harness.events.idleStateChanged, "idle");
  harness.setNow(now + 80_000);
  harness.setIdleState("active");
  await eventsCall(harness.events.idleStateChanged, "active");
  harness.setNow(now + 85_000);
  harness.setFocusedWindowId(-1);
  await eventsCall(harness.events.windowFocusChanged, -1);

  assert.equal(harness.state.usageStats[day]["youtube.com"].usageSeconds, 25);
  assert.equal(harness.state.usageEvents.length, 3);
});

test("URL changes close the previous domain without storing paths or unsupported schemes", async () => {
  const now = 1_800_000_000_000;
  const day = new Date(now).toLocaleDateString("en-CA");
  const harness = createHarness({
    initialNow: now,
    initialState: baseState(),
    tabs: [
      {
        id: 1,
        windowId: 1,
        active: true,
        url: "https://www.youtube.com/watch?v=sensitive"
      }
    ]
  });
  await settle();

  harness.setNow(now + 7_000);
  harness.setTabUrl(1, "https://www.reddit.com/r/sensitive");
  await eventsCall(
    harness.events.tabUpdated,
    1,
    { url: "https://www.reddit.com/r/sensitive" },
    {}
  );
  harness.setNow(now + 15_000);
  harness.setTabUrl(1, "chrome://settings/privacy");
  await eventsCall(
    harness.events.tabUpdated,
    1,
    { url: "chrome://settings/privacy" },
    {}
  );

  assert.equal(harness.state.usageStats[day]["youtube.com"].usageSeconds, 7);
  assert.equal(harness.state.usageStats[day]["reddit.com"].usageSeconds, 8);
  assert.equal(harness.state.usageTracker, null);
  assert.deepEqual(
    harness.state.usageEvents.map((event) => event.host),
    ["reddit.com", "youtube.com"]
  );
  assert.equal(
    JSON.stringify({
      usageStats: harness.state.usageStats,
      usageEvents: harness.state.usageEvents
    }).includes("sensitive"),
    false
  );
});

test("heartbeat checkpoints survive restart and cap unexplained elapsed gaps", async () => {
  const now = 1_800_000_000_000;
  const day = new Date(now).toLocaleDateString("en-CA");
  const tab = {
    id: 1,
    windowId: 1,
    active: true,
    url: "https://youtube.com/"
  };
  const first = createHarness({
    initialNow: now,
    initialState: baseState(),
    tabs: [tab]
  });
  await settle();
  assert.equal(first.alarms.get("usage-heartbeat").periodInMinutes, 1);

  first.setNow(now + 60_000);
  await eventsCall(first.events.alarm, { name: "usage-heartbeat" });
  assert.equal(first.state.usageStats[day]["youtube.com"].usageSeconds, 60);

  const restarted = createHarness({
    initialNow: now + 120_000,
    initialState: clone(first.state),
    tabs: [tab]
  });
  await settle();
  assert.equal(
    restarted.state.usageStats[day]["youtube.com"].usageSeconds,
    120
  );

  restarted.setNow(now + 12 * 60_000);
  await eventsCall(restarted.events.alarm, { name: "usage-heartbeat" });
  assert.equal(
    restarted.state.usageStats[day]["youtube.com"].usageSeconds,
    420
  );
});

test("unsupported active-tab schemes never create usage records", async () => {
  const now = 1_800_000_000_000;
  const harness = createHarness({
    initialNow: now,
    initialState: baseState(),
    tabs: [
      {
        id: 1,
        windowId: 1,
        active: true,
        url: "file:///Users/person/private.txt"
      }
    ]
  });
  await settle();
  harness.setNow(now + 60_000);
  await eventsCall(harness.events.alarm, { name: "usage-heartbeat" });

  assert.deepEqual(harness.state.usageStats, {});
  assert.deepEqual(harness.state.usageEvents, []);
  assert.equal(harness.state.usageTracker, null);
});

test("active-tab measurement can be paused and resumed from settings", async () => {
  const now = 1_800_000_000_000;
  const day = new Date(now).toLocaleDateString("en-CA");
  const harness = createHarness({
    initialNow: now,
    initialState: baseState({ usageTrackingEnabled: true }),
    tabs: [
      {
        id: 1,
        windowId: 1,
        active: true,
        url: "https://youtube.com/watch?v=private"
      }
    ]
  });
  await settle();

  harness.setNow(now + 15_000);
  harness.state.usageTrackingEnabled = false;
  await eventsCall(
    harness.events.storageChanged,
    {
      usageTrackingEnabled: {
        oldValue: true,
        newValue: false
      }
    },
    "local"
  );
  assert.equal(harness.state.usageStats[day]["youtube.com"].usageSeconds, 15);
  assert.equal(harness.state.usageTracker, null);

  harness.setNow(now + 75_000);
  await eventsCall(harness.events.alarm, { name: "usage-heartbeat" });
  assert.equal(harness.state.usageStats[day]["youtube.com"].usageSeconds, 15);

  harness.state.usageTrackingEnabled = true;
  await eventsCall(
    harness.events.storageChanged,
    {
      usageTrackingEnabled: {
        oldValue: false,
        newValue: true
      }
    },
    "local"
  );
  harness.setNow(now + 85_000);
  await eventsCall(harness.events.alarm, { name: "usage-heartbeat" });
  assert.equal(harness.state.usageStats[day]["youtube.com"].usageSeconds, 25);
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
