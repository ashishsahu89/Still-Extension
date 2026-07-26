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

async function ensureDefaults() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const missing = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (stored[key] === undefined) missing[key] = value;
  }
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
}

function dateKey(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleDateString("en-CA");
}

function normalizeHost(host) {
  return host.replace(/^www\./, "").toLowerCase();
}

function matchesProtected(host, siteHost) {
  return host === siteHost || host.endsWith(`.${siteHost}`);
}

function enabledSites(sites = []) {
  return sites
    .filter((site) => site.enabled)
    .map(({ host, label }) => ({ host, label }));
}

function routineSites(routine, sites = []) {
  const selected = new Set(routine?.siteHosts || []);
  return sites
    .filter((site) => selected.has(site.host))
    .map(({ host, label }) => ({ host, label }));
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
  return focus?.protectedSites?.length ? focus.protectedSites : enabledSites(sites);
}

function normalizeFocus(focus, sites, strictFocus) {
  if (!focus) return null;
  return {
    ...focus,
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
  const stats = { ...(data.stats || {}) };
  const key = dateKey();
  const day = normalizedDay(stats[key]);
  day.impulsesPaused += 1;
  stats[key] = day;

  const siteStats = { ...(data.siteStats || {}) };
  const siteDay = { ...(siteStats[key] || {}) };
  const activity = normalizedSiteActivity(siteDay[site.host]);
  activity.impulses += 1;
  siteDay[site.host] = activity;
  siteStats[key] = siteDay;

  const impulseEvents = [...(data.impulseEvents || [])];
  impulseEvents.unshift({ host: site.host, createdAt: Date.now() });
  impulseEvents.splice(2000);
  await chrome.storage.local.set({ stats, siteStats, impulseEvents });
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
  if (!focusActive && (data.passes?.[site.host] || 0) > now) return null;

  return {
    site,
    focusActive,
    focusEndAt: data.focus?.endAt || 0,
    strictFocus: focusActive ? data.focus?.strict !== false : data.strictFocus !== false
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

  try {
    await chrome.tabs.update(details.tabId, { url: interventionUrl(details.url, result) });
  } catch {
    // The tab may close between the navigation event and the redirect.
  }
}

chrome.webNavigation.onBeforeNavigate.addListener(handleNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(handleNavigation);

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
    focusExits.splice(30);
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
  focusSessions.splice(500);

  await chrome.alarms.clear("focus-complete");
  await chrome.storage.local.set({
    focus: null,
    stats,
    focusExits,
    focusSessions
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
  const data = await chrome.storage.local.get([
    "focus",
    "passes",
    "passStarts",
    "siteStats"
  ]);
  if (data.focus?.endAt > Date.now()) {
    return { ok: false, reason: "focus-active", focus: data.focus };
  }
  const focus = {
    startedAt,
    endAt,
    minutes: Math.max(1, Math.ceil((endAt - startedAt) / 60000)),
    intention,
    strict,
    protectedSites,
    source,
    routineId,
    routineOccurrenceStart
  };
  for (const siteHost of Object.keys(data.passes || {})) {
    await chrome.alarms.clear(`pass:${siteHost}`);
  }
  await chrome.storage.local.set({
    focus,
    activeRoutine: null,
    passes: {},
    passStarts: {},
    siteStats: closePasses(data, startedAt)
  });
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
    return;
  }

  const focus = normalizeFocus(data.focus, data.protectedSites, data.strictFocus);
  if (focus.endAt <= Date.now()) {
    await chrome.storage.local.set({ focus });
    await finishFocus({ completed: true, endedAt: focus.endAt });
    return;
  }

  await chrome.storage.local.set({ focus });
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
  if (focus?.endAt > Date.now()) {
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
    return;
  }
  for (const [siteHost, endAt] of Object.entries(passes)) {
    if (endAt <= Date.now()) await expirePass(siteHost);
    else chrome.alarms.create(`pass:${siteHost}`, { when: endAt });
  }
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
    await ensureDefaults();
    await restoreFocusState();
    await restorePassState();
    await reconcileRoutineState();
  })().finally(() => {
    reconcilePromise = null;
  });
  return reconcilePromise;
}

chrome.runtime.onInstalled.addListener(() => void reconcileState());
chrome.runtime.onStartup.addListener(() => void reconcileState());
void reconcileState();

chrome.alarms.onAlarm.addListener(async (alarm) => {
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
});

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
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
});

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || (!changes.routines && !changes.protectedSites)) return;
    void reconcileRoutineState();
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_FOCUS") {
    (async () => {
      const data = await chrome.storage.local.get([
        "protectedSites",
        "strictFocus"
      ]);
      const startedAt = Date.now();
      const minutes = Math.max(5, Math.min(120, Number(message.minutes) || 25));
      const result = await startFocus({
        startedAt,
        endAt: startedAt + minutes * 60000,
        intention: message.intention || "",
        strict: data.strictFocus !== false,
        protectedSites: enabledSites(data.protectedSites),
        source: "manual"
      });
      sendResponse(result);
    })();
    return true;
  }

  if (message.type === "REQUEST_FOCUS_EXIT") {
    (async () => {
      const { focus } = await chrome.storage.local.get("focus");
      if (!focus) {
        sendResponse({ ok: false, reason: "no-active-focus" });
        return;
      }
      if (focus.strict === false) {
        sendResponse({ ok: true, unlockAt: Date.now(), strict: false });
        return;
      }
      const exitRequestedAt = focus.exitRequestedAt || Date.now();
      if (!focus.exitRequestedAt) {
        await chrome.storage.local.set({ focus: { ...focus, exitRequestedAt } });
      }
      sendResponse({
        ok: true,
        strict: true,
        unlockAt: exitRequestedAt + EXIT_COOLDOWN_MS
      });
    })();
    return true;
  }

  if (message.type === "CANCEL_FOCUS_EXIT") {
    (async () => {
      const { focus } = await chrome.storage.local.get("focus");
      if (focus?.exitRequestedAt) {
        const updated = { ...focus };
        delete updated.exitRequestedAt;
        await chrome.storage.local.set({ focus: updated });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "STOP_FOCUS") {
    (async () => {
      const { focus } = await chrome.storage.local.get("focus");
      if (!focus) {
        sendResponse({ ok: true, alreadyStopped: true });
        return;
      }
      const emergency = message.emergency === true;
      const reason = String(message.reason || "").trim();
      if (focus.strict !== false && !emergency) {
        const unlockAt = (focus.exitRequestedAt || 0) + EXIT_COOLDOWN_MS;
        if (!focus.exitRequestedAt || Date.now() < unlockAt) {
          sendResponse({ ok: false, reason: "cooldown-active", unlockAt });
          return;
        }
        if (reason.length < 3) {
          sendResponse({ ok: false, reason: "reason-required" });
          return;
        }
      }
      if (emergency && message.confirmed !== true) {
        sendResponse({ ok: false, reason: "emergency-confirmation-required" });
        return;
      }
      const result = await finishFocus({
        completed: false,
        reason,
        emergency
      });
      await skipFocusRoutineOccurrence(focus);
      await reconcileRoutineState();
      sendResponse({ ok: true, ...result });
    })();
    return true;
  }

  if (message.type === "ALLOW_SITE") {
    (async () => {
      const {
        passes = {},
        passStarts = {},
        intentions = []
      } = await chrome.storage.local.get([
        "passes",
        "passStarts",
        "intentions"
      ]);
      const startedAt = Date.now();
      const endAt = startedAt + 5 * 60000;
      passes[message.host] = endAt;
      passStarts[message.host] = startedAt;
      if (message.intention) {
        intentions.unshift({
          text: message.intention,
          host: message.host,
          createdAt: startedAt
        });
        intentions.splice(30);
      }
      await chrome.storage.local.set({ passes, passStarts, intentions });
      chrome.alarms.create(`pass:${message.host}`, { when: endAt });
      sendResponse({ ok: true, endAt });
    })();
    return true;
  }

  if (message.type === "PASS_EXPIRED") {
    (async () => {
      const { passes = {} } = await chrome.storage.local.get("passes");
      const endAt = passes[message.host] || 0;
      if (!message.force && endAt > Date.now() + 1000) {
        sendResponse({ ok: false, reason: "pass-active" });
        return;
      }
      const expired = await expirePass(message.host, sender.tab);
      sendResponse({ ok: expired });
    })();
    return true;
  }
});
