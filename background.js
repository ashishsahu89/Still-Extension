const DEFAULTS = {
  protectedSites: [
    { host: "youtube.com", label: "YouTube", enabled: true },
    { host: "instagram.com", label: "Instagram", enabled: true },
    { host: "reddit.com", label: "Reddit", enabled: true },
    { host: "x.com", label: "X", enabled: false },
    { host: "facebook.com", label: "Facebook", enabled: false }
  ],
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
  chromeAIEnabled: false,
  aiCategoryCache: {},
  aiInsightCache: {},
  impulseEvents: [],
  focusSessions: [],
  intentions: [],
  focusExits: [],
  routines: [],
  routineSkips: {},
  activeRoutine: null,
  dismissedRoutineSuggestions: {}
};

const EXIT_COOLDOWN_MS = 20000;
const ROUTINE_NOTICE_MS = 5 * 60 * 1000;
const ROUTINE_ALARM_PREFIX = "routine:";
const CURRENT_STORAGE_SCHEMA = 2;
const RAW_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const DAILY_RETENTION_MS = 550 * 24 * 60 * 60 * 1000;
const USAGE_HEARTBEAT_ALARM = "usage-heartbeat";
const USAGE_HEARTBEAT_MINUTES = 1;
const MAX_USAGE_GAP_MS = 5 * 60 * 1000;
const MAX_USAGE_EVENTS = 5000;
const STRICT_RULE_ID = 10001;
const PASS_SCRIPT_PREFIX = "still-pass-";

let stateTaskQueue = Promise.resolve();

function reportBackgroundError(context, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Still] ${context}: ${message}`);
}

function runStateTask(context, task) {
  const result = stateTaskQueue.then(task);
  stateTaskQueue = result.catch((error) => {
    reportBackgroundError(context, error);
  });
  return result;
}

async function ensureDefaults() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const missing = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (stored[key] === undefined) missing[key] = value;
  }
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
}

function pruneDatedRecord(record = {}, cutoff) {
  const source =
    record && typeof record === "object" && !Array.isArray(record) ? record : {};
  const cutoffKey = dateKey(cutoff);
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && key >= cutoffKey
    )
  );
}

function pruneStoredHistory(data, now = Date.now()) {
  const rawCutoff = now - RAW_EVENT_RETENTION_MS;
  const dailyCutoff = now - DAILY_RETENTION_MS;
  return {
    stats: pruneDatedRecord(data.stats, dailyCutoff),
    siteStats: pruneDatedRecord(data.siteStats, dailyCutoff),
    usageStats: pruneDatedRecord(data.usageStats, dailyCutoff),
    usageEvents: (Array.isArray(data.usageEvents) ? data.usageEvents : [])
      .filter(
        (event) =>
          validStoredHost(normalizeHost(event?.host)) &&
          Number.isFinite(event?.startedAt) &&
          Number.isFinite(event?.endedAt) &&
          event.endedAt >= rawCutoff
      )
      .slice(0, MAX_USAGE_EVENTS),
    impulseEvents: (Array.isArray(data.impulseEvents) ? data.impulseEvents : [])
      .filter((event) => Number.isFinite(event?.createdAt) && event.createdAt >= rawCutoff)
      .slice(0, 2000),
    focusSessions: (Array.isArray(data.focusSessions) ? data.focusSessions : [])
      .filter((session) => Number.isFinite(session?.startedAt) && session.startedAt >= dailyCutoff)
      .slice(0, 500),
    focusExits: (Array.isArray(data.focusExits) ? data.focusExits : [])
      .filter((exit) => Number.isFinite(exit?.createdAt) && exit.createdAt >= rawCutoff)
      .slice(0, 30)
  };
}

async function migrateStorage() {
  const stored = await chrome.storage.local.get(null);
  let version = Number(stored.storageSchemaVersion) || 0;
  const pruned = pruneStoredHistory(stored);
  const updates = Object.fromEntries(
    Object.entries(pruned).filter(
      ([key, value]) => JSON.stringify(stored[key]) !== JSON.stringify(value)
    )
  );

  while (version < CURRENT_STORAGE_SCHEMA) {
    if (version === 0) {
      version = 1;
      continue;
    }
    if (version === 1) {
      version = 2;
      continue;
    }
    throw new Error(`No storage migration is available from version ${version}`);
  }

  if (version > CURRENT_STORAGE_SCHEMA) {
    throw new Error(`Storage schema ${version} is newer than this extension supports`);
  }
  if (stored.storageSchemaVersion !== version) {
    updates.storageSchemaVersion = version;
  }
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
}

function dateKey(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleDateString("en-CA");
}

function normalizeHost(host) {
  return String(host || "").replace(/^www\./, "").toLowerCase();
}

function matchesProtected(host, siteHost) {
  return Boolean(siteHost) && (host === siteHost || host.endsWith(`.${siteHost}`));
}

function validStoredHost(host) {
  const ipv4Parts = host.split(".");
  const validIpv4 =
    ipv4Parts.length === 4 &&
    ipv4Parts.every(
      (part) =>
        /^(?:0|[1-9]\d{0,2})$/.test(part) &&
        Number(part) >= 0 &&
        Number(part) <= 255
    );
  return (
    host === "localhost" ||
    validIpv4 ||
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
  );
}

function safeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function enabledSites(sites = []) {
  return (Array.isArray(sites) ? sites : [])
    .filter((site) => site?.enabled)
    .map(({ host, label }) => ({
      host: normalizeHost(host),
      label: safeText(label, 80)
    }))
    .filter((site) => validStoredHost(site.host));
}

function routineSites(routine, sites = []) {
  const selected = new Set(
    (Array.isArray(routine?.siteHosts) ? routine.siteHosts : []).map(normalizeHost)
  );
  return enabledSites(sites).filter((site) => selected.has(site.host));
}

function timeParts(value = "") {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function occurrenceOnDate(routine, date) {
  const start = timeParts(routine.startTime);
  const end = timeParts(routine.endTime);
  if (!start || !end || !(routine.days || []).includes(date.getDay())) return null;
  const startAt = new Date(date);
  startAt.setHours(start.hour, start.minute, 0, 0);
  const endAt = new Date(date);
  endAt.setHours(end.hour, end.minute, 0, 0);
  if (endAt <= startAt) return null;
  return { startAt: startAt.getTime(), endAt: endAt.getTime() };
}

function currentRoutineOccurrence(routine, timestamp = Date.now()) {
  const occurrence = occurrenceOnDate(routine, new Date(timestamp));
  if (!occurrence) return null;
  return occurrence.startAt <= timestamp && timestamp < occurrence.endAt
    ? occurrence
    : null;
}

function nextRoutineOccurrence(routine, timestamp = Date.now()) {
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(timestamp);
    date.setDate(date.getDate() + offset);
    const occurrence = occurrenceOnDate(routine, date);
    if (occurrence?.startAt > timestamp) return occurrence;
  }
  return null;
}

function occurrenceKey(routineId, startAt) {
  return `${routineId}:${startAt}`;
}

function routineAlarmName(stage, routineId, startAt) {
  return `${ROUTINE_ALARM_PREFIX}${stage}:${routineId}:${startAt}`;
}

function parseRoutineTarget(value) {
  const match = /^(?:routine:)?(pre|start|end):([^:]+):(\d+)$/.exec(value);
  return match
    ? { stage: match[1], routineId: match[2], startAt: Number(match[3]) }
    : null;
}

function focusSites(focus, sites = []) {
  const snapshot = (Array.isArray(focus?.protectedSites)
    ? focus.protectedSites
    : []
  )
    .map((site) => ({
      host: normalizeHost(site?.host),
      label: safeText(site?.label, 80)
    }))
    .filter((site) => validStoredHost(site.host));
  return snapshot.length ? snapshot : enabledSites(sites);
}

function normalizeFocus(focus, sites, strictFocus) {
  if (!focus || typeof focus !== "object") return null;
  const startedAt = Number(focus.startedAt);
  const endAt = Number(focus.endAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endAt) || endAt <= startedAt) {
    return null;
  }
  return {
    ...focus,
    startedAt,
    endAt,
    intention: safeText(focus.intention, 100),
    strict: focus.strict ?? (strictFocus !== false),
    protectedSites: focusSites(focus, sites)
  };
}

function interventionUrl(url, result) {
  const page = new URL(chrome.runtime.getURL("intervention.html"));
  page.searchParams.set("url", url);
  page.searchParams.set("host", result.site.host);
  page.searchParams.set("label", result.site.label);
  page.searchParams.set("focus", String(result.focusActive));
  if (result.focusEndAt) page.searchParams.set("focusEndAt", String(result.focusEndAt));
  page.searchParams.set("strict", String(result.strictFocus));
  return page.toString();
}

function strictInterventionUrl() {
  const page = new URL(chrome.runtime.getURL("intervention.html"));
  page.searchParams.set("focus", "true");
  page.searchParams.set("strict", "true");
  return page.toString();
}

async function syncStrictRules(focus = null) {
  const removeRuleIds = (await chrome.declarativeNetRequest.getDynamicRules())
    .filter((rule) => rule.id === STRICT_RULE_ID)
    .map((rule) => rule.id);
  const addRules = [];
  if (focus?.endAt > Date.now() && focus.strict !== false) {
    const requestDomains = (focus.protectedSites || [])
      .map((site) => normalizeHost(site.host))
      .filter(validStoredHost);
    if (requestDomains.length) {
      addRules.push({
        id: STRICT_RULE_ID,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { url: strictInterventionUrl() }
        },
        condition: {
          requestDomains: [...new Set(requestDomains)],
          resourceTypes: ["main_frame"]
        }
      });
    }
  }
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });
}

function passScriptId(host) {
  let hash = 2166136261;
  for (const character of host) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const readable = host.replace(/[^a-z0-9]/g, "-").slice(0, 40);
  return `${PASS_SCRIPT_PREFIX}${readable}-${(hash >>> 0).toString(36)}`;
}

function passMatchPatterns(host) {
  const exact = `*://${host}/*`;
  if (host === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return [exact];
  }
  return [exact, `*://*.${host}/*`];
}

async function syncPassContentScripts(passes = {}) {
  const now = Date.now();
  const passRecord =
    passes && typeof passes === "object" && !Array.isArray(passes) ? passes : {};
  const activeHosts = Object.entries(passRecord)
    .filter(([host, endAt]) => validStoredHost(host) && Number(endAt) > now)
    .map(([host]) => host);
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const existingIds = registered
    .map((script) => script.id)
    .filter((id) => id.startsWith(PASS_SCRIPT_PREFIX));
  if (existingIds.length) {
    await chrome.scripting.unregisterContentScripts({ ids: existingIds });
  }
  if (!activeHosts.length) return;
  await chrome.scripting.registerContentScripts(
    activeHosts.map((host) => ({
      id: passScriptId(host),
      js: ["pass-countdown.js"],
      matches: passMatchPatterns(host),
      persistAcrossSessions: true,
      runAt: "document_idle"
    }))
  );
}

function normalizedDay(day = {}) {
  const focusedSeconds =
    typeof day.focusedSeconds === "number"
      ? day.focusedSeconds
      : (day.focusedMinutes || 0) * 60;
  return {
    ...day,
    focusedSeconds,
    focusedMinutes: Math.floor(focusedSeconds / 60),
    impulsesPaused: day.impulsesPaused || 0,
    sessions: day.sessions || 0,
    interruptedSessions: day.interruptedSessions || 0
  };
}

function normalizedSiteActivity(activity = {}) {
  return {
    impulses: activity.impulses || 0,
    usageSeconds: activity.usageSeconds || 0
  };
}

function addSiteUsage(siteStats, host, startedAt, endedAt) {
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  if (!host || !Number.isFinite(startedAt) || !Number.isFinite(endedAt) || !seconds) {
    return siteStats;
  }
  const key = dateKey(startedAt);
  const day = { ...(siteStats[key] || {}) };
  const activity = normalizedSiteActivity(day[host]);
  activity.usageSeconds += seconds;
  day[host] = activity;
  return { ...siteStats, [key]: day };
}

function usageHost(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    const host = normalizeHost(parsed.hostname);
    return validStoredHost(host) ? host : "";
  } catch {
    return "";
  }
}

function normalizedUsageActivity(activity = {}) {
  return {
    usageSeconds:
      Number.isFinite(activity?.usageSeconds) && activity.usageSeconds > 0
        ? activity.usageSeconds
        : 0
  };
}

function addDailyUsage(
  usageStats,
  host,
  startedAt,
  endedAt,
  totalSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1000))
) {
  let updated = { ...(usageStats || {}) };
  let cursor = startedAt;
  let remainingSeconds = totalSeconds;
  while (cursor < endedAt) {
    const nextDay = new Date(cursor);
    nextDay.setHours(24, 0, 0, 0);
    const segmentEnd = Math.min(endedAt, nextDay.getTime());
    const seconds =
      segmentEnd === endedAt
        ? remainingSeconds
        : Math.min(
            remainingSeconds,
            Math.max(0, Math.floor((segmentEnd - cursor) / 1000))
          );
    if (seconds) {
      const key = dateKey(cursor);
      const day = { ...(updated[key] || {}) };
      const activity = normalizedUsageActivity(day[host]);
      activity.usageSeconds += seconds;
      day[host] = activity;
      updated = { ...updated, [key]: day };
    }
    remainingSeconds -= seconds;
    cursor = segmentEnd;
  }
  return updated;
}

function validUsageTracker(tracker) {
  return (
    tracker &&
    Number.isInteger(tracker.tabId) &&
    Number.isInteger(tracker.windowId) &&
    validStoredHost(normalizeHost(tracker.host)) &&
    Number.isFinite(tracker.checkpointAt) &&
    Number.isFinite(tracker.eventStartedAt) &&
    Number.isFinite(tracker.eventUsageSeconds)
  );
}

async function flushUsageTracker({ endEvent = false, now = Date.now() } = {}) {
  const data = await chrome.storage.local.get([
    "usageTracker",
    "usageStats",
    "usageEvents"
  ]);
  if (!validUsageTracker(data.usageTracker)) {
    if (data.usageTracker) await chrome.storage.local.set({ usageTracker: null });
    return null;
  }

  const tracker = {
    ...data.usageTracker,
    host: normalizeHost(data.usageTracker.host)
  };
  const rawElapsed = Math.max(0, now - tracker.checkpointAt);
  const elapsed = Math.min(rawElapsed, MAX_USAGE_GAP_MS);
  const countedEndAt = tracker.checkpointAt + elapsed;
  const addedSeconds = Math.max(0, Math.round(elapsed / 1000));
  let usageStats = data.usageStats || {};
  if (addedSeconds) {
    usageStats = addDailyUsage(
      usageStats,
      tracker.host,
      tracker.checkpointAt,
      countedEndAt,
      addedSeconds
    );
  }
  usageStats = pruneDatedRecord(
    usageStats,
    now - DAILY_RETENTION_MS
  );

  const eventUsageSeconds = tracker.eventUsageSeconds + addedSeconds;
  if (!endEvent) {
    const usageTracker = {
      ...tracker,
      checkpointAt: now,
      eventUsageSeconds
    };
    await chrome.storage.local.set({ usageStats, usageTracker });
    return usageTracker;
  }

  let usageEvents = Array.isArray(data.usageEvents) ? data.usageEvents : [];
  if (eventUsageSeconds > 0) {
    usageEvents = [
      {
        host: tracker.host,
        startedAt: tracker.eventStartedAt,
        endedAt: now,
        usageSeconds: eventUsageSeconds
      },
      ...usageEvents
    ];
  }
  const rawCutoff = now - RAW_EVENT_RETENTION_MS;
  usageEvents = usageEvents
    .filter(
      (event) =>
        validStoredHost(normalizeHost(event?.host)) &&
        Number.isFinite(event?.startedAt) &&
        Number.isFinite(event?.endedAt) &&
        event.endedAt >= rawCutoff
    )
    .slice(0, MAX_USAGE_EVENTS);
  await chrome.storage.local.set({
    usageStats,
    usageEvents,
    usageTracker: null
  });
  return null;
}

async function currentTrackableTab() {
  const { usageTrackingEnabled } =
    await chrome.storage.local.get("usageTrackingEnabled");
  if (usageTrackingEnabled === false) return null;
  const idleState = await chrome.idle.queryState(60);
  if (idleState !== "active") return null;
  const focusedWindow = await chrome.windows.getLastFocused();
  if (
    !focusedWindow ||
    focusedWindow.focused === false ||
    focusedWindow.id === chrome.windows.WINDOW_ID_NONE
  ) {
    return null;
  }
  const [tab] = await chrome.tabs.query({
    active: true,
    windowId: focusedWindow.id
  });
  const host = usageHost(tab?.url);
  if (!tab || !Number.isInteger(tab.id) || !host) return null;
  return { tabId: tab.id, windowId: focusedWindow.id, host };
}

function ensureUsageHeartbeat() {
  chrome.alarms.create(USAGE_HEARTBEAT_ALARM, {
    periodInMinutes: USAGE_HEARTBEAT_MINUTES
  });
}

async function pauseUsageTracking() {
  await flushUsageTracker({ endEvent: true });
  ensureUsageHeartbeat();
}

async function reconcileUsageTracker() {
  const now = Date.now();
  const current = await currentTrackableTab();
  const { usageTracker } = await chrome.storage.local.get("usageTracker");
  const trackerMatches =
    validUsageTracker(usageTracker) &&
    current &&
    usageTracker.tabId === current.tabId &&
    usageTracker.windowId === current.windowId &&
    normalizeHost(usageTracker.host) === current.host;

  if (trackerMatches) {
    await flushUsageTracker({ now });
  } else {
    await flushUsageTracker({ endEvent: true, now });
    if (current) {
      await chrome.storage.local.set({
        usageTracker: {
          ...current,
          checkpointAt: now,
          eventStartedAt: now,
          eventUsageSeconds: 0
        }
      });
    }
  }
  ensureUsageHeartbeat();
}

function closePasses(data, endedAt = Date.now()) {
  let siteStats = { ...(data.siteStats || {}) };
  for (const [host, startedAt] of Object.entries(data.passStarts || {})) {
    const passEnd = data.passes?.[host] || endedAt;
    siteStats = addSiteUsage(siteStats, host, startedAt, Math.min(endedAt, passEnd));
  }
  return siteStats;
}

async function addImpulse(site) {
  const data = await chrome.storage.local.get([
    "stats",
    "siteStats",
    "impulseEvents"
  ]);
  let stats = { ...(data.stats || {}) };
  const key = dateKey();
  const day = normalizedDay(stats[key]);
  day.impulsesPaused += 1;
  stats[key] = day;

  let siteStats = { ...(data.siteStats || {}) };
  const siteDay = { ...(siteStats[key] || {}) };
  const activity = normalizedSiteActivity(siteDay[site.host]);
  activity.impulses += 1;
  siteDay[site.host] = activity;
  siteStats[key] = siteDay;

  const impulseEvents = [...(data.impulseEvents || [])];
  impulseEvents.unshift({ host: site.host, createdAt: Date.now() });
  const rawCutoff = Date.now() - RAW_EVENT_RETENTION_MS;
  const retainedEvents = impulseEvents
    .filter((event) => Number.isFinite(event?.createdAt) && event.createdAt >= rawCutoff)
    .slice(0, 2000);
  const dailyCutoff = Date.now() - DAILY_RETENTION_MS;
  stats = pruneDatedRecord(stats, dailyCutoff);
  siteStats = pruneDatedRecord(siteStats, dailyCutoff);
  await chrome.storage.local.set({
    stats,
    siteStats,
    impulseEvents: retainedEvents
  });
}

async function shouldIntercept(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;

  const data = await chrome.storage.local.get([
    "protectedSites",
    "mindfulMode",
    "strictFocus",
    "focus",
    "passes",
    "activeRoutine"
  ]);
  const now = Date.now();
  const focusActive = data.focus?.endAt > now;
  const routineActive = !focusActive && data.activeRoutine?.endAt > now;
  const sites = focusActive
    ? focusSites(data.focus, data.protectedSites)
    : routineActive
      ? data.activeRoutine.protectedSites || []
      : enabledSites(data.protectedSites);
  const host = normalizeHost(parsed.hostname);
  const site = sites.find((item) => matchesProtected(host, item.host));
  if (!site) return null;

  if (!data.mindfulMode && !focusActive && !routineActive) return null;
  const strictFocus = focusActive
    ? data.focus?.strict !== false
    : data.strictFocus !== false;
  if ((!focusActive || !strictFocus) && (data.passes?.[site.host] || 0) > now) {
    return null;
  }

  return {
    site,
    focusActive,
    focusEndAt: data.focus?.endAt || 0,
    strictFocus
  };
}

const redirectingTabs = new Map();

async function handleNavigation(details) {
  if (details.frameId !== 0) return;
  const last = redirectingTabs.get(details.tabId);
  if (last && Date.now() - last < 1200) return;

  const result = await shouldIntercept(details.url);
  if (!result) return;

  redirectingTabs.set(details.tabId, Date.now());
  setTimeout(() => redirectingTabs.delete(details.tabId), 1600);
  await addImpulse(result.site);
  if (result.focusActive && result.strictFocus) return;

  try {
    await chrome.tabs.update(details.tabId, { url: interventionUrl(details.url, result) });
  } catch {
    // The tab may close between the navigation event and the redirect.
  }
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  void runStateTask("before-navigation", () => handleNavigation(details));
});
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  void runStateTask("history-navigation", () => handleNavigation(details));
});

async function redirectOpenProtectedTabs(focus) {
  const tabs = await chrome.tabs.query({});
  const sites = focusSites(focus);
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || !tab.url) return;
      let host;
      try {
        host = normalizeHost(new URL(tab.url).hostname);
      } catch {
        return;
      }
      const site = sites.find((item) => matchesProtected(host, item.host));
      if (!site) return;
      try {
        await chrome.tabs.update(tab.id, {
          url: interventionUrl(tab.url, {
            site,
            focusActive: true,
            focusEndAt: focus.endAt,
            strictFocus: focus.strict !== false
          })
        });
      } catch {
        // A restricted or closed tab should not prevent focus from starting.
      }
    })
  );
}

async function finishFocus({
  completed,
  endedAt = Date.now(),
  reason = "",
  emergency = false
}) {
  const data = await chrome.storage.local.get([
    "focus",
    "stats",
    "focusExits",
    "focusSessions"
  ]);
  const focus = data.focus;
  if (!focus) return null;

  const actualSeconds = Math.max(
    0,
    Math.round((Math.min(endedAt, focus.endAt) - focus.startedAt) / 1000)
  );
  const key = dateKey(focus.startedAt);
  const stats = { ...(data.stats || {}) };
  const day = normalizedDay(stats[key]);
  day.focusedSeconds += actualSeconds;
  day.focusedMinutes = Math.floor(day.focusedSeconds / 60);
  day.sessions += 1;
  if (!completed) day.interruptedSessions += 1;
  stats[key] = day;

  const focusExits = [...(data.focusExits || [])];
  if (!completed) {
    focusExits.unshift({
      reason: reason.trim() || (emergency ? "Emergency exit" : "Ended early"),
      emergency,
      createdAt: endedAt,
      elapsedSeconds: actualSeconds,
      intention: focus.intention || ""
    });
  }

  const focusSessions = [...(data.focusSessions || [])];
  focusSessions.unshift({
    startedAt: focus.startedAt,
    endedAt,
    focusedSeconds: actualSeconds,
    completed,
    intention: focus.intention || "",
    source: focus.source || "manual",
    routineId: focus.routineId || null
  });
  const rawCutoff = endedAt - RAW_EVENT_RETENTION_MS;
  const dailyCutoff = endedAt - DAILY_RETENTION_MS;
  const retainedExits = focusExits
    .filter((exit) => Number.isFinite(exit?.createdAt) && exit.createdAt >= rawCutoff)
    .slice(0, 30);
  const retainedSessions = focusSessions
    .filter(
      (session) =>
        Number.isFinite(session?.startedAt) && session.startedAt >= dailyCutoff
    )
    .slice(0, 500);

  await chrome.alarms.clear("focus-complete");
  await syncStrictRules(null);
  await chrome.storage.local.set({
    focus: null,
    stats,
    focusExits: retainedExits,
    focusSessions: retainedSessions
  });
  await chrome.action.setBadgeText({ text: "" });
  return { actualSeconds, completed };
}

async function startFocus({
  startedAt = Date.now(),
  endAt,
  intention = "",
  strict = true,
  protectedSites = [],
  source = "manual",
  routineId = null,
  routineOccurrenceStart = null
}) {
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endAt) ||
    endAt <= startedAt
  ) {
    return { ok: false, reason: "invalid-focus-window" };
  }
  const data = await chrome.storage.local.get([
    "focus",
    "activeRoutine",
    "passes",
    "passStarts",
    "siteStats"
  ]);
  if (data.focus?.endAt > Date.now()) {
    return { ok: false, reason: "focus-active", focus: data.focus };
  }
  const safeSites = (Array.isArray(protectedSites) ? protectedSites : [])
    .map((site) => ({
      host: normalizeHost(site?.host),
      label: safeText(site?.label, 80)
    }))
    .filter((site) => validStoredHost(site.host));
  const focus = {
    startedAt,
    endAt,
    minutes: Math.max(1, Math.ceil((endAt - startedAt) / 60000)),
    intention: safeText(intention, 100),
    strict: strict !== false,
    protectedSites: safeSites,
    source: source === "routine" ? "routine" : "manual",
    routineId: safeText(routineId, 100) || null,
    routineOccurrenceStart
  };
  for (const siteHost of Object.keys(data.passes || {})) {
    await chrome.alarms.clear(`pass:${siteHost}`);
  }
  try {
    await chrome.storage.local.set({
      focus,
      activeRoutine: null,
      passes: {},
      passStarts: {},
      siteStats: closePasses(data, startedAt)
    });
    await syncStrictRules(focus);
    await syncPassContentScripts({});
  } catch (error) {
    await Promise.allSettled([
      chrome.storage.local.set({
        focus: null,
        activeRoutine: data.activeRoutine || null,
        passes: data.passes || {},
        passStarts: data.passStarts || {},
        siteStats: data.siteStats || {}
      }),
      syncStrictRules(null),
      syncPassContentScripts(data.passes || {})
    ]);
    for (const [siteHost, passEndAt] of Object.entries(data.passes || {})) {
      if (passEndAt > Date.now()) {
        chrome.alarms.create(`pass:${siteHost}`, { when: passEndAt });
      }
    }
    throw error;
  }
  chrome.alarms.create("focus-complete", { when: focus.endAt });
  await chrome.action.setBadgeBackgroundColor({ color: "#496A51" });
  const remainingMinutes = Math.max(1, Math.ceil((focus.endAt - Date.now()) / 60000));
  await chrome.action.setBadgeText({ text: String(remainingMinutes) });
  await redirectOpenProtectedTabs(focus);
  return { ok: true, focus };
}

async function restoreFocusState() {
  const data = await chrome.storage.local.get([
    "focus",
    "protectedSites",
    "strictFocus"
  ]);
  if (!data.focus) {
    await chrome.alarms.clear("focus-complete");
    await chrome.action.setBadgeText({ text: "" });
    await syncStrictRules(null);
    return;
  }

  const focus = normalizeFocus(data.focus, data.protectedSites, data.strictFocus);
  if (!focus) {
    await chrome.storage.local.set({ focus: null });
    await chrome.alarms.clear("focus-complete");
    await chrome.action.setBadgeText({ text: "" });
    await syncStrictRules(null);
    return;
  }
  if (focus.endAt <= Date.now()) {
    await chrome.storage.local.set({ focus });
    await finishFocus({ completed: true, endedAt: focus.endAt });
    return;
  }

  await chrome.storage.local.set({ focus });
  await syncStrictRules(focus);
  chrome.alarms.create("focus-complete", { when: focus.endAt });
  await chrome.action.setBadgeBackgroundColor({ color: "#496A51" });
  const remainingMinutes = Math.max(1, Math.ceil((focus.endAt - Date.now()) / 60000));
  await chrome.action.setBadgeText({ text: String(remainingMinutes) });
}

async function expirePass(siteHost, preferredTab) {
  const data = await chrome.storage.local.get([
    "passes",
    "passStarts",
    "siteStats",
    "protectedSites",
    "focus",
    "strictFocus",
    "activeRoutine"
  ]);
  const passes = { ...(data.passes || {}) };
  const passStarts = { ...(data.passStarts || {}) };
  let siteStats = { ...(data.siteStats || {}) };
  const startedAt = passStarts[siteHost];
  const scheduledEnd = passes[siteHost] || Date.now();
  if (startedAt) {
    siteStats = addSiteUsage(
      siteStats,
      siteHost,
      startedAt,
      Math.min(Date.now(), scheduledEnd)
    );
  }
  delete passes[siteHost];
  delete passStarts[siteHost];
  await chrome.storage.local.set({ passes, passStarts, siteStats });
  await syncPassContentScripts(passes);
  await chrome.alarms.clear(`pass:${siteHost}`);

  const now = Date.now();
  const focusActive = data.focus?.endAt > now;
  const routineActive = !focusActive && data.activeRoutine?.endAt > now;
  const focusSite = focusActive
    ? focusSites(data.focus, data.protectedSites).find((item) => item.host === siteHost)
    : null;
  const routineSite = routineActive
    ? (data.activeRoutine.protectedSites || []).find((item) => item.host === siteHost)
    : null;
  const configuredSite = (data.protectedSites || []).find((item) => item.host === siteHost);
  const site = focusSite || routineSite || configuredSite;
  if (!site || (!focusSite && !routineSite && !configuredSite.enabled)) return true;

  const result = {
    site,
    focusActive,
    focusEndAt: data.focus?.endAt || 0,
    strictFocus: focusActive ? data.focus?.strict !== false : data.strictFocus !== false
  };
  const tabs = preferredTab ? [preferredTab] : await chrome.tabs.query({});

  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || !tab.url) return;
      let host;
      try {
        host = normalizeHost(new URL(tab.url).hostname);
      } catch {
        return;
      }
      if (!matchesProtected(host, siteHost)) return;
      try {
        await chrome.tabs.update(tab.id, {
          url: interventionUrl(tab.url, result)
        });
      } catch {
        // One unavailable tab should not prevent the rest from expiring.
      }
    })
  );
  return true;
}

async function restorePassState() {
  const data = await chrome.storage.local.get([
    "passes",
    "passStarts",
    "siteStats",
    "focus"
  ]);
  const passes = data.passes || {};
  const focus = data.focus;
  if (focus?.endAt > Date.now() && focus.strict !== false) {
    for (const siteHost of Object.keys(passes)) {
      await chrome.alarms.clear(`pass:${siteHost}`);
    }
    if (Object.keys(passes).length || Object.keys(data.passStarts || {}).length) {
      await chrome.storage.local.set({
        passes: {},
        passStarts: {},
        siteStats: closePasses(data)
      });
    }
    await syncPassContentScripts({});
    return;
  }
  for (const [siteHost, endAt] of Object.entries(passes)) {
    if (endAt <= Date.now()) await expirePass(siteHost);
    else chrome.alarms.create(`pass:${siteHost}`, { when: endAt });
  }
  const { passes: currentPasses = {} } = await chrome.storage.local.get("passes");
  await syncPassContentScripts(currentPasses);
}

async function clearRoutineAlarms(routineId = "", includeEnd = false) {
  const alarms = await chrome.alarms.getAll();
  const prefix = routineId ? `${ROUTINE_ALARM_PREFIX}` : ROUTINE_ALARM_PREFIX;
  await Promise.all(
    alarms
      .filter((alarm) => {
        if (!alarm.name.startsWith(prefix)) return false;
        const parsed = parseRoutineTarget(alarm.name);
        if (!includeEnd && parsed?.stage === "end") return false;
        if (!routineId) return true;
        return parsed?.routineId === routineId;
      })
      .map((alarm) => chrome.alarms.clear(alarm.name))
  );
}

async function showRoutineNotification(routine, occurrence) {
  const id = routineAlarmName("start", routine.id, occurrence.startAt);
  const mode = routine.mode === "strict" ? "Strict focus" : "Mindful pauses";
  const automatic =
    routine.startBehavior === "automatic"
      ? " It will begin automatically."
      : "";
  await chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
    title: `${routine.name} begins soon`,
    message: `${mode} · until ${new Date(occurrence.endAt).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    })}.${automatic}`,
    buttons: [{ title: "Start now" }, { title: "Skip today" }],
    priority: 1
  });
}

async function markRoutineSkipped(routine, occurrence) {
  const { routineSkips = {}, activeRoutine } = await chrome.storage.local.get([
    "routineSkips",
    "activeRoutine"
  ]);
  const updated = { ...routineSkips, [occurrenceKey(routine.id, occurrence.startAt)]: true };
  if (
    activeRoutine?.routineId === routine.id &&
    activeRoutine?.routineOccurrenceStart === occurrence.startAt
  ) {
    await chrome.storage.local.set({ routineSkips: updated, activeRoutine: null });
  } else {
    await chrome.storage.local.set({ routineSkips: updated });
  }
  await chrome.notifications.clear(
    routineAlarmName("start", routine.id, occurrence.startAt)
  );
}

async function skipFocusRoutineOccurrence(focus) {
  if (
    focus?.source !== "routine" ||
    !focus.routineId ||
    !focus.routineOccurrenceStart
  ) {
    return;
  }
  const { routineSkips = {} } = await chrome.storage.local.get("routineSkips");
  await chrome.storage.local.set({
    routineSkips: {
      ...routineSkips,
      [occurrenceKey(focus.routineId, focus.routineOccurrenceStart)]: true
    }
  });
}

async function activateRoutine(routine, occurrence) {
  const data = await chrome.storage.local.get([
    "protectedSites",
    "focus",
    "routineSkips",
    "activeRoutine"
  ]);
  if (
    !routine?.enabled ||
    occurrence.endAt <= Date.now() ||
    data.routineSkips?.[occurrenceKey(routine.id, occurrence.startAt)]
  ) {
    return { ok: false, reason: "unavailable" };
  }
  if (data.focus?.endAt > Date.now()) {
    return { ok: false, reason: "focus-active" };
  }
  if (data.activeRoutine?.endAt > Date.now()) {
    const sameOccurrence =
      data.activeRoutine.routineId === routine.id &&
      data.activeRoutine.routineOccurrenceStart === occurrence.startAt;
    return sameOccurrence
      ? { ok: true, activeRoutine: data.activeRoutine }
      : { ok: false, reason: "routine-active" };
  }
  const protectedSites = routineSites(routine, data.protectedSites);
  if (!protectedSites.length) return { ok: false, reason: "no-sites" };

  await chrome.notifications.clear(
    routineAlarmName("start", routine.id, occurrence.startAt)
  );
  if (routine.mode === "strict") {
    return startFocus({
      startedAt: Date.now(),
      endAt: occurrence.endAt,
      intention: routine.topic || routine.name,
      strict: true,
      protectedSites,
      source: "routine",
      routineId: routine.id,
      routineOccurrenceStart: occurrence.startAt
    });
  }

  const activeRoutine = {
    routineId: routine.id,
    routineOccurrenceStart: occurrence.startAt,
    name: routine.name,
    endAt: occurrence.endAt,
    protectedSites
  };
  await chrome.storage.local.set({ activeRoutine });
  chrome.alarms.create(
    routineAlarmName("end", routine.id, occurrence.startAt),
    { when: occurrence.endAt }
  );
  return { ok: true, activeRoutine };
}

async function scheduleRoutineAlarms(routines = []) {
  await clearRoutineAlarms();
  const now = Date.now();
  for (const routine of routines) {
    if (!routine.enabled) continue;
    const occurrence = nextRoutineOccurrence(routine, now);
    if (!occurrence) continue;
    const noticeAt = occurrence.startAt - ROUTINE_NOTICE_MS;
    if (noticeAt > now) {
      chrome.alarms.create(
        routineAlarmName("pre", routine.id, occurrence.startAt),
        { when: noticeAt }
      );
    }
    chrome.alarms.create(
      routineAlarmName("start", routine.id, occurrence.startAt),
      { when: occurrence.startAt }
    );
  }
}

async function reconcileRoutineState() {
  const data = await chrome.storage.local.get([
    "routines",
    "routineSkips",
    "activeRoutine",
    "focus"
  ]);
  const now = Date.now();
  const routineSkips = Object.fromEntries(
    Object.entries(data.routineSkips || {}).filter(([key]) => {
      const timestamp = Number(key.slice(key.lastIndexOf(":") + 1));
      return Number.isFinite(timestamp) && timestamp > now - 8 * 24 * 60 * 60 * 1000;
    })
  );
  let activeRoutine = data.activeRoutine;
  if (activeRoutine?.endAt <= now) activeRoutine = null;
  if (
    activeRoutine &&
    !(data.routines || []).some(
      (routine) => routine.id === activeRoutine.routineId && routine.enabled
    )
  ) {
    activeRoutine = null;
  }
  await chrome.storage.local.set({ routineSkips, activeRoutine });

  if (!data.focus?.endAt || data.focus.endAt <= now) {
    for (const routine of data.routines || []) {
      if (!routine.enabled) continue;
      const occurrence = currentRoutineOccurrence(routine, now);
      if (
        !occurrence ||
        routineSkips[occurrenceKey(routine.id, occurrence.startAt)]
      ) {
        continue;
      }
      if (routine.startBehavior === "automatic") {
        await activateRoutine(routine, occurrence);
        break;
      }
      await showRoutineNotification(routine, occurrence);
    }
  }
  await scheduleRoutineAlarms(data.routines || []);
}

let reconcilePromise;
function reconcileState() {
  if (reconcilePromise) return reconcilePromise;
  reconcilePromise = (async () => {
    await migrateStorage();
    await ensureDefaults();
    await reconcileUsageTracker();
    await restoreFocusState();
    await restorePassState();
    await reconcileRoutineState();
  })().finally(() => {
    reconcilePromise = null;
  });
  return reconcilePromise;
}

chrome.runtime.onInstalled.addListener(() => {
  void runStateTask("install-reconcile", reconcileState);
});
chrome.runtime.onStartup.addListener(() => {
  void runStateTask("startup-reconcile", reconcileState);
});
void runStateTask("initial-reconcile", reconcileState);

async function handleAlarm(alarm) {
  if (alarm.name === USAGE_HEARTBEAT_ALARM) {
    await reconcileUsageTracker();
    return;
  }

  if (alarm.name === "focus-complete") {
    const { focus } = await chrome.storage.local.get("focus");
    if (!focus) return;
    if (focus.endAt > Date.now() + 1000) {
      chrome.alarms.create("focus-complete", { when: focus.endAt });
      return;
    }
    await finishFocus({ completed: true, endedAt: focus.endAt });
    await reconcileRoutineState();
    return;
  }

  if (alarm.name.startsWith("pass:")) {
    await expirePass(alarm.name.slice(5));
    return;
  }

  if (alarm.name.startsWith(ROUTINE_ALARM_PREFIX)) {
    const target = parseRoutineTarget(alarm.name);
    if (!target) return;
    const { stage } = target;
    const { routines = [], routineSkips = {}, activeRoutine } =
      await chrome.storage.local.get(["routines", "routineSkips", "activeRoutine"]);
    const routine = routines.find((item) => item.id === target.routineId);
    const occurrence = routine
      ? occurrenceOnDate(routine, new Date(target.startAt))
      : null;
    if (!routine || !routine.enabled || occurrence?.startAt !== target.startAt) {
      await scheduleRoutineAlarms(routines);
      return;
    }
    if (stage === "pre") {
      if (!routineSkips[occurrenceKey(routine.id, occurrence.startAt)]) {
        await showRoutineNotification(routine, occurrence);
      }
    } else if (stage === "start") {
      if (routine.startBehavior === "automatic") {
        await activateRoutine(routine, occurrence);
      } else if (!routineSkips[occurrenceKey(routine.id, occurrence.startAt)]) {
        await showRoutineNotification(routine, occurrence);
      }
    } else if (
      stage === "end" &&
      activeRoutine?.routineId === routine.id &&
      activeRoutine?.routineOccurrenceStart === occurrence.startAt
    ) {
      await chrome.storage.local.set({ activeRoutine: null });
    }
    await scheduleRoutineAlarms(routines);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  void runStateTask(`alarm:${alarm.name}`, () => handleAlarm(alarm));
});

chrome.tabs.onActivated.addListener(() => {
  void runStateTask("usage-tab-activated", reconcileUsageTracker);
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (!changeInfo.url) return;
  void runStateTask("usage-tab-url-changed", reconcileUsageTracker);
});
chrome.tabs.onRemoved.addListener(() => {
  void runStateTask("usage-tab-removed", reconcileUsageTracker);
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  void runStateTask(
    "usage-window-focus-changed",
    windowId === chrome.windows.WINDOW_ID_NONE
      ? pauseUsageTracking
      : reconcileUsageTracker
  );
});
chrome.idle.onStateChanged.addListener((state) => {
  void runStateTask(
    "usage-idle-state-changed",
    state === "active" ? reconcileUsageTracker : pauseUsageTracking
  );
});

async function handleNotificationButton(notificationId, buttonIndex) {
  const target = parseRoutineTarget(notificationId);
  if (!target) return;
  const { routines = [] } = await chrome.storage.local.get("routines");
  const routine = routines.find((item) => item.id === target.routineId);
  const occurrence = routine
    ? occurrenceOnDate(routine, new Date(target.startAt))
    : null;
  if (!routine || occurrence?.startAt !== target.startAt) return;
  if (buttonIndex === 0) await activateRoutine(routine, occurrence);
  if (buttonIndex === 1) await markRoutineSkipped(routine, occurrence);
}

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  void runStateTask(`notification:${notificationId}`, () =>
    handleNotificationButton(notificationId, buttonIndex)
  );
});

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.routines || changes.protectedSites) {
      void runStateTask("settings-reconcile", reconcileRoutineState);
    }
    if (changes.usageTrackingEnabled) {
      void runStateTask(
        "usage-setting-changed",
        changes.usageTrackingEnabled.newValue === false
          ? pauseUsageTracking
          : reconcileUsageTracker
      );
    }
  });
}

function senderIsExtensionPage(sender, page) {
  if (sender?.id !== chrome.runtime.id || typeof sender.url !== "string") return false;
  const expected = chrome.runtime.getURL(page);
  return sender.url === expected || sender.url.startsWith(`${expected}?`);
}

function senderMatchesHost(sender, host) {
  if (sender?.id !== chrome.runtime.id || !sender.tab?.url) return false;
  try {
    const senderHost = normalizeHost(new URL(sender.tab.url).hostname);
    return matchesProtected(senderHost, host);
  } catch {
    return false;
  }
}

async function allowSite(message) {
  const host = normalizeHost(message.host);
  if (!validStoredHost(host)) return { ok: false, reason: "invalid-host" };
  const data = await chrome.storage.local.get([
    "protectedSites",
    "mindfulMode",
    "focus",
    "activeRoutine",
    "passes",
    "passStarts",
    "intentions"
  ]);
  const now = Date.now();
  const focusActive = data.focus?.endAt > now;
  const strictFocus = focusActive && data.focus?.strict !== false;
  if (strictFocus) return { ok: false, reason: "strict-focus-active" };
  const routineActive = !focusActive && data.activeRoutine?.endAt > now;
  if (!focusActive && !routineActive && data.mindfulMode === false) {
    return { ok: false, reason: "mindful-mode-disabled" };
  }
  const availableSites = focusActive
    ? focusSites(data.focus, data.protectedSites)
    : routineActive
      ? data.activeRoutine.protectedSites || []
      : enabledSites(data.protectedSites);
  const site = availableSites.find((item) => item.host === host);
  if (!site) return { ok: false, reason: "site-not-protected" };

  const startedAt = now;
  const endAt = startedAt + 5 * 60000;
  const passes = { ...(data.passes || {}), [host]: endAt };
  const passStarts = { ...(data.passStarts || {}), [host]: startedAt };
  const intention = safeText(message.intention, 100);
  const intentions = [...(data.intentions || [])];
  if (intention) {
    intentions.unshift({ text: intention, host, createdAt: startedAt });
    intentions.splice(30);
  }
  await chrome.storage.local.set({ passes, passStarts, intentions });
  try {
    await syncPassContentScripts(passes);
  } catch (error) {
    delete passes[host];
    delete passStarts[host];
    await chrome.storage.local.set({ passes, passStarts });
    throw error;
  }
  chrome.alarms.create(`pass:${host}`, { when: endAt });
  return { ok: true, endAt };
}

async function handleMessage(message, sender) {
  if (!message || typeof message !== "object" || typeof message.type !== "string") {
    return { ok: false, reason: "invalid-message" };
  }

  if (
    ["START_FOCUS", "REQUEST_FOCUS_EXIT", "CANCEL_FOCUS_EXIT", "STOP_FOCUS"].includes(
      message.type
    ) &&
    !senderIsExtensionPage(sender, "popup.html")
  ) {
    return { ok: false, reason: "invalid-sender" };
  }
  if (
    ["ALLOW_SITE", "CLEAR_STALE_STRICT_RULES"].includes(message.type) &&
    !senderIsExtensionPage(sender, "intervention.html")
  ) {
    return { ok: false, reason: "invalid-sender" };
  }

  if (message.type === "START_FOCUS") {
    const data = await chrome.storage.local.get([
      "protectedSites",
      "strictFocus"
    ]);
    const requestedMinutes = Number(message.minutes);
    const minutes = Number.isFinite(requestedMinutes)
      ? Math.max(5, Math.min(120, requestedMinutes))
      : 25;
    const startedAt = Date.now();
    return startFocus({
      startedAt,
      endAt: startedAt + minutes * 60000,
      intention: safeText(message.intention, 100),
      strict: data.strictFocus !== false,
      protectedSites: enabledSites(data.protectedSites),
      source: "manual"
    });
  }

  if (message.type === "REQUEST_FOCUS_EXIT") {
    const { focus } = await chrome.storage.local.get("focus");
    if (!focus) return { ok: false, reason: "no-active-focus" };
    if (focus.strict === false) {
      return { ok: true, unlockAt: Date.now(), strict: false };
    }
    const exitRequestedAt = focus.exitRequestedAt || Date.now();
    if (!focus.exitRequestedAt) {
      await chrome.storage.local.set({ focus: { ...focus, exitRequestedAt } });
    }
    return {
      ok: true,
      strict: true,
      unlockAt: exitRequestedAt + EXIT_COOLDOWN_MS
    };
  }

  if (message.type === "CANCEL_FOCUS_EXIT") {
    const { focus } = await chrome.storage.local.get("focus");
    if (focus?.exitRequestedAt) {
      const updated = { ...focus };
      delete updated.exitRequestedAt;
      await chrome.storage.local.set({ focus: updated });
    }
    return { ok: true };
  }

  if (message.type === "STOP_FOCUS") {
    const { focus } = await chrome.storage.local.get("focus");
    if (!focus) return { ok: true, alreadyStopped: true };
    const emergency = message.emergency === true;
    const reason = safeText(message.reason, 120);
    if (focus.strict !== false && !emergency) {
      const unlockAt = (focus.exitRequestedAt || 0) + EXIT_COOLDOWN_MS;
      if (!focus.exitRequestedAt || Date.now() < unlockAt) {
        return { ok: false, reason: "cooldown-active", unlockAt };
      }
      if (reason.length < 3) {
        return { ok: false, reason: "reason-required" };
      }
    }
    if (emergency && message.confirmed !== true) {
      return { ok: false, reason: "emergency-confirmation-required" };
    }
    const result = await finishFocus({
      completed: false,
      reason,
      emergency
    });
    await skipFocusRoutineOccurrence(focus);
    await reconcileRoutineState();
    return { ok: true, ...result };
  }

  if (message.type === "ALLOW_SITE") {
    return allowSite(message);
  }

  if (message.type === "PASS_EXPIRED") {
    const host = normalizeHost(message.host);
    if (!validStoredHost(host) || !senderMatchesHost(sender, host)) {
      return { ok: false, reason: "invalid-sender" };
    }
    const { passes = {} } = await chrome.storage.local.get("passes");
    const endAt = passes[host] || 0;
    if (!message.force && endAt > Date.now() + 1000) {
      return { ok: false, reason: "pass-active" };
    }
    const expired = await expirePass(host, sender.tab);
    return { ok: expired };
  }

  if (message.type === "CLEAR_STALE_STRICT_RULES") {
    const { focus } = await chrome.storage.local.get("focus");
    if (focus?.endAt > Date.now() && focus.strict !== false) {
      return { ok: false, reason: "strict-focus-active" };
    }
    await syncStrictRules(null);
    return { ok: true };
  }

  return { ok: false, reason: "unknown-message" };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void runStateTask(`message:${message?.type || "unknown"}`, () =>
    handleMessage(message, sender)
  ).then(sendResponse, () => {
    sendResponse({ ok: false, reason: "internal-error" });
  });
  return true;
});
