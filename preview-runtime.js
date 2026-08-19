/* Local-page preview only. Chrome ignores this shim because its extension API already exists. */
const previewParams = new URLSearchParams(location.search);
const previewAIState = previewParams.get("ai");
if (location.protocol.startsWith("http") && previewParams.get("connection") === "success") {
  globalThis.StillPreviewAIConnectionFetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { choices: [{ message: { content: "ready" } }] };
    }
  });
}
if (
  location.protocol.startsWith("http") &&
  ["light", "dark"].includes(previewParams.get("theme"))
) {
  document.documentElement.dataset.previewTheme = previewParams.get("theme");
}
if (
  location.protocol.startsWith("http") &&
  ["available", "downloadable", "downloading", "unavailable", "unsupported"].includes(previewAIState)
) {
  globalThis.StillPreviewLanguageModel = previewAIState === "unsupported" ? {} : {
    async availability() {
      return previewAIState;
    },
    async create(options = {}) {
      if (previewAIState === "unavailable") {
        throw new Error("The preview model is unavailable.");
      }
      if (typeof options.monitor === "function") {
        options.monitor({
          addEventListener(type, listener) {
            if (type === "downloadprogress") listener({ loaded: 1 });
          }
        });
      }
      return {
        async prompt(prompt) {
          if (String(prompt).includes('"classifications"')) {
            return JSON.stringify({ classifications: [] });
          }
          if (String(prompt).includes('"groupId"')) {
            return JSON.stringify({ groups: [{ groupId: 1, title: "Tech news" }] });
          }
          return "Your active time is concentrated in a few familiar categories.";
        },
        async destroy() {}
      };
    }
  };
}

if (typeof chrome === "undefined" || !chrome.storage?.local) {

  const dateKey = (date) => date.toLocaleDateString("en-CA");
  const atLocalTime = (date, hour, minute = 0) => {
    const value = new Date(date);
    value.setHours(hour, minute, 0, 0);
    return value.getTime();
  };
  const addDays = (date, amount) => {
    const value = new Date(date);
    value.setDate(value.getDate() + amount);
    return value;
  };

  const stats = {};
  const siteStats = {};
  const usageStats = {};
  const usageEvents = [];
  const impulseEvents = [];
  const focusSessions = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekMinutes = [35, 48, 62, 45, 54, 50, 30];
  const weekSessions = [1, 2, 2, 1, 2, 2, 2];
  const weekImpulses = [4, 6, 5, 7, 4, 6, 5];
  const sitePattern = [
    ["youtube.com", "reddit.com", "instagram.com"],
    ["youtube.com", "instagram.com", "reddit.com"]
  ];

  for (let offset = 27; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const weekdayIndex = (date.getDay() + 6) % 7;
    const recent = offset <= 6;
    const focusedMinutes = recent
      ? weekMinutes[weekdayIndex]
      : 22 + ((offset * 17) % 51);
    const sessions = recent
      ? weekSessions[weekdayIndex]
      : 1 + (offset % 2);
    const impulses = recent
      ? weekImpulses[weekdayIndex]
      : 2 + ((offset * 5) % 7);
    const key = dateKey(date);
    stats[key] = {
      focusedSeconds: focusedMinutes * 60,
      focusedMinutes,
      impulsesPaused: impulses,
      sessions,
      interruptedSessions: offset % 9 === 0 ? 1 : 0
    };

    const siteDay = {};
    for (let index = 0; index < impulses; index += 1) {
      const host = sitePattern[offset % 2][index % 3];
      const activity = siteDay[host] || { impulses: 0, usageSeconds: 0 };
      activity.impulses += 1;
      if (index % 3 === 0) activity.usageSeconds += 180 + ((offset + index) % 4) * 60;
      siteDay[host] = activity;
      const hour = index % 5 < 1 ? 9 : index % 5 < 4 ? 15 : 20;
      impulseEvents.push({
        host,
        createdAt: atLocalTime(date, hour, 8 + index * 3)
      });
    }
    siteStats[key] = siteDay;

    const usageDay = {
      "github.com": { usageSeconds: (18 + (offset % 4) * 4) * 60 },
      "youtube.com": { usageSeconds: (10 + (offset % 5) * 3) * 60 },
      "mail.google.com": { usageSeconds: (7 + (offset % 3) * 2) * 60 },
      "reddit.com": { usageSeconds: (6 + (offset % 4) * 2) * 60 },
      "wikipedia.org": { usageSeconds: (4 + (offset % 2) * 3) * 60 }
    };
    usageStats[key] = usageDay;
    Object.entries(usageDay).forEach(([host, activity], index) => {
      const startedAt = atLocalTime(date, [10, 15, 11, 20, 14][index], 5 + index * 4);
      usageEvents.push({
        host,
        startedAt,
        endedAt: startedAt + activity.usageSeconds * 1000,
        usageSeconds: activity.usageSeconds
      });
    });

    const perSession = Math.floor((focusedMinutes * 60) / sessions);
    for (let index = 0; index < sessions; index += 1) {
      const startedAt = atLocalTime(date, index === 0 ? 9 : 14, 20 + index * 15);
      focusSessions.push({
        startedAt,
        endedAt: startedAt + perSession * 1000,
        focusedSeconds: perSession,
        completed: !(offset % 9 === 0 && index === sessions - 1),
        intention: [
          "Finish the product brief",
          "Deep work",
          "Review the prototype",
          "Write without switching tabs"
        ][(offset + index) % 4]
      });
    }
  }

  const previewState = {
    protectedSites: [
      { host: "youtube.com", label: "YouTube", enabled: true },
      { host: "instagram.com", label: "Instagram", enabled: true },
      { host: "reddit.com", label: "Reddit", enabled: true }
    ],
    mindfulMode: true,
    strictFocus: true,
    pauseSeconds: 8,
    usageTrackingEnabled: true,
    linkTrailGroupingEnabled: true,
    chromeAIEnabled: false,
    aiCategoryCache: {},
    aiInsightCache: {},
    aiConnections: [],
    activeAIConnectionId: "",
    focus: null,
    passes: {},
    passStarts: {},
    stats,
    siteStats,
    usageStats,
    usageEvents,
    impulseEvents,
    focusSessions,
    routines: [
      {
        id: "weekday-deep-work",
        name: "Weekday deep work",
        days: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "11:00",
        mode: "strict",
        startBehavior: "ask",
        topic: "Finish the product brief",
        siteHosts: ["youtube.com", "instagram.com", "reddit.com"],
        enabled: true
      },
      {
        id: "evening-wind-down",
        name: "Evening wind-down",
        days: [0, 1, 2, 3, 4, 5, 6],
        startTime: "21:00",
        endTime: "22:30",
        mode: "mindful",
        startBehavior: "automatic",
        topic: "",
        siteHosts: ["youtube.com", "reddit.com"],
        enabled: true
      }
    ],
    routineSkips: {},
    activeRoutine: null,
    dismissedRoutineSuggestions: {},
    tabOrganizerRemoteNamingConsent: {},
    intentions: [
      {
        text: "Watch the launch tutorial",
        host: "youtube.com",
        createdAt: atLocalTime(today, 15, 12)
      },
      {
        text: "Check one saved discussion",
        host: "reddit.com",
        createdAt: atLocalTime(addDays(today, -1), 18, 4)
      }
    ]
  };
  if (["true", "regular"].includes(previewParams.get("focus"))) {
    previewState.focus = {
      startedAt: Date.now() - 7 * 60000,
      endAt: Date.now() + 18 * 60000,
      minutes: 25,
      intention: "Finish the draft",
      strict: previewParams.get("focus") !== "regular",
      protectedSites: previewState.protectedSites
        .filter((site) => site.enabled)
        .map(({ host, label }) => ({ host, label }))
    };
  }

  const storageListeners = [];
  const previewSessionState = { aiConnectionSecrets: {} };
  const previewTabs = [
    { id: 1, windowId: 1, index: 0, active: true, url: "https://news.ycombinator.com/", title: "Hacker News" },
    { id: 2, windowId: 1, index: 1, url: "https://arxiv.org/abs/123", title: "A paper" },
    { id: 3, windowId: 1, index: 2, url: "https://reddit.com/r/webdev", title: "Web development" },
    { id: 4, windowId: 1, index: 3, url: "https://instagram.com/", title: "Instagram" }
  ];
  let previewUndoAvailable = false;
  const previewChrome = globalThis.chrome || {};
  Object.assign(previewChrome, {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: previewState[keys] };
          if (!keys) return { ...previewState };
          return Object.fromEntries(keys.map((key) => [key, previewState[key]]));
        },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: previewState[key], newValue: value };
          }
          Object.assign(previewState, values);
          for (const listener of storageListeners) listener(changes, "local");
        }
      },
      session: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: previewSessionState[keys] };
          if (!keys) return { ...previewSessionState };
          return Object.fromEntries(keys.map((key) => [key, previewSessionState[key]]));
        },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: previewSessionState[key], newValue: value };
          }
          Object.assign(previewSessionState, values);
          for (const listener of storageListeners) listener(changes, "session");
        }
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        }
      }
    },
    runtime: {
      async sendMessage(message) {
        if (message.type === "GET_TAB_ORGANIZER_STATUS") {
          return { ok: true, eligibleTabs: previewTabs.length, managedGroups: 0, undoAvailable: previewUndoAvailable };
        }
        if (message.type === "ORGANIZE_TABS") {
          previewUndoAvailable = true;
          return {
            ok: true,
            undoAvailable: true,
            groups: [
              {
                id: 1,
                fallbackName: "Social",
                tabs: [
                  { id: 3, host: "reddit.com", title: "Web development" },
                  { id: 4, host: "instagram.com", title: "Instagram" }
                ]
              }
            ]
          };
        }
        if (message.type === "UNDO_TAB_ORGANIZATION") {
          previewUndoAvailable = false;
          return { ok: true };
        }
        if (message.type === "APPLY_TAB_GROUP_NAMES") return { ok: true, applied: message.groups?.map((group) => group.groupId) || [] };
        if (message.type === "START_FOCUS") {
          previewState.focus = {
            startedAt: Date.now(),
            endAt: Date.now() + message.minutes * 60000,
            minutes: message.minutes,
            intention: message.intention,
            strict: previewState.strictFocus,
            protectedSites: previewState.protectedSites
              .filter((site) => site.enabled)
              .map(({ host, label }) => ({ host, label }))
          };
        }
        if (message.type === "REQUEST_FOCUS_EXIT" && previewState.focus) {
          previewState.focus.exitRequestedAt ||= Date.now();
          return {
            ok: true,
            strict: true,
            unlockAt: previewState.focus.exitRequestedAt + 20000
          };
        }
        if (message.type === "CANCEL_FOCUS_EXIT" && previewState.focus) {
          delete previewState.focus.exitRequestedAt;
        }
        if (message.type === "STOP_FOCUS") {
          const unlockAt = (previewState.focus?.exitRequestedAt || 0) + 20000;
          if (
            previewState.focus?.strict !== false &&
            !message.emergency &&
            Date.now() < unlockAt
          ) {
            return { ok: false, reason: "cooldown-active", unlockAt };
          }
          previewState.focus = null;
        }
        if (message.type === "PASS_EXPIRED") {
          setTimeout(() => {
            const target = new URL("intervention.html", location.href);
            target.searchParams.set("url", "https://youtube.com/");
            target.searchParams.set("host", "youtube.com");
            target.searchParams.set("label", "YouTube");
            target.searchParams.set("focus", previewState.focus ? "true" : "false");
            target.searchParams.set("strict", String(previewState.focus?.strict !== false));
            target.searchParams.set("state", message.state || "pass-expired");
            target.searchParams.set("cooldownUntil", String(Date.now() + 25 * 60000));
            if (message.state !== "task-expired" && !previewState.focus) {
              target.searchParams.set("taskEligible", "true");
            }
            location.replace(target);
          }, 0);
        }
        return { ok: true };
      },
      openOptionsPage() {
        location.href = "options.html";
      }
    },
    tabs: {
      async getCurrent() {
        // A local preview has no Chrome extension tab to close.
        return null;
      },
      async remove() {},
      async query() {
        return previewTabs;
      }
    }
  });
  globalThis.chrome = previewChrome;
}
