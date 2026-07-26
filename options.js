const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const VIEW_COPY = {
  protection: {
    title: "Protection",
    intro: "Shape the space between impulse and choice.",
    documentTitle: "Protection · Still"
  },
  insights: {
    title: "Insights",
    intro: "Notice the pattern. Keep what helps.",
    documentTitle: "Insights · Still"
  },
  routines: {
    title: "Routines",
    intro: "Let focus begin before distraction does.",
    documentTitle: "Routines · Still"
  },
  data: {
    title: "Data & privacy",
    intro: "Everything stays on this device.",
    documentTitle: "Data & privacy · Still"
  }
};

const PERIOD_COPY = {
  day: "Today",
  week: "This week",
  month: "This month"
};

let currentPeriod = "week";
let savedTimer;
let insightsData = null;
let routineFormOpen = false;
let currentRoutineSuggestion = null;
let reviewingRoutineSuggestion = false;
const SUGGESTION_DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

function normalizeInput(value) {
  const candidate = value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  return candidate.replace(/^www\./, "");
}

function validHost(host) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host);
}

function labelFromHost(host) {
  const root = host.split(".")[0];
  return root.charAt(0).toUpperCase() + root.slice(1);
}

function localDateKey(date = new Date()) {
  return date.toLocaleDateString("en-CA");
}

function startOfDay(date = new Date()) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function startOfWeek(date = new Date()) {
  const copy = startOfDay(date);
  const mondayOffset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - mondayOffset);
  return copy;
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function rangeForPeriod(period, now = new Date()) {
  let start;
  let end;
  if (period === "day") {
    start = startOfDay(now);
    end = addDays(start, 1);
  } else if (period === "month") {
    start = startOfMonth(now);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  } else {
    start = startOfWeek(now);
    end = addDays(start, 7);
  }
  return { start, end };
}

function formatRange(start, end, period) {
  if (period === "day") {
    return start.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric"
    });
  }
  const inclusiveEnd = addDays(end, -1);
  const sameMonth = start.getMonth() === inclusiveEnd.getMonth();
  const startLabel = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
  const endLabel = inclusiveEnd.toLocaleDateString(undefined, {
    month: sameMonth ? undefined : "short",
    day: "numeric"
  });
  return `${startLabel}–${endLabel}`;
}

function inRange(timestamp, range) {
  return timestamp >= range.start.getTime() && timestamp < range.end.getTime();
}

function normalizedDay(day = {}) {
  const focusedSeconds =
    typeof day.focusedSeconds === "number"
      ? day.focusedSeconds
      : (day.focusedMinutes || 0) * 60;
  return {
    focusedSeconds,
    impulsesPaused: day.impulsesPaused || 0,
    sessions: day.sessions || 0
  };
}

function formatDuration(seconds) {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatUsage(seconds) {
  if (!seconds) return "0m";
  if (seconds < 60) return "<1m";
  return formatDuration(seconds);
}

function occurrenceOnDate(routine, date) {
  if (!(routine.days || []).includes(date.getDay())) return null;
  const [startHour, startMinute] = routine.startTime.split(":").map(Number);
  const [endHour, endMinute] = routine.endTime.split(":").map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return null;
  const start = new Date(date);
  const end = new Date(date);
  start.setHours(startHour, startMinute, 0, 0);
  end.setHours(endHour, endMinute, 0, 0);
  if (end <= start) return null;
  return { startAt: start.getTime(), endAt: end.getTime() };
}

function nextRoutineOccurrence(routine, timestamp = Date.now()) {
  if (!routine.enabled) return null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(timestamp);
    date.setDate(date.getDate() + offset);
    const occurrence = occurrenceOnDate(routine, date);
    if (occurrence?.startAt > timestamp) return occurrence;
  }
  return null;
}

function formatRoutineDays(days = []) {
  const sorted = [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (sorted.length === 7) return "Every day";
  if (sorted.join(",") === "1,2,3,4,5") return "Weekdays";
  if (sorted.join(",") === "6,0") return "Weekends";
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return sorted.map((day) => labels[day]).join(", ");
}

function formatRoutineTime(value) {
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatRoutineTimeRange(startValue, endValue) {
  const formatPart = (value) => {
    const [hour, minute] = value.split(":").map(Number);
    const clockHour = hour % 12 || 12;
    const clockMinute = minute ? `:${String(minute).padStart(2, "0")}` : "";
    return {
      clock: `${clockHour}${clockMinute}`,
      period: hour >= 12 ? "PM" : "AM"
    };
  };
  const start = formatPart(startValue);
  const end = formatPart(endValue);
  return start.period === end.period
    ? `${start.clock}–${end.clock} ${end.period}`
    : `${start.clock} ${start.period}–${end.clock} ${end.period}`;
}

function formatNextOccurrence(routine) {
  const next = nextRoutineOccurrence(routine);
  if (!next) return "Paused";
  const date = new Date(next.startAt);
  const today = localDateKey(date) === localDateKey();
  const tomorrow = localDateKey(date) === localDateKey(addDays(new Date(), 1));
  const day = today
    ? "Today"
    : tomorrow
      ? "Tomorrow"
      : date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return `Next: ${day} at ${formatRoutineTime(routine.startTime)}`;
}

function routineId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `routine-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function showSaved() {
  clearTimeout(savedTimer);
  $("#saved").textContent = "Saved";
  $("#saved").classList.add("is-saving");
  savedTimer = setTimeout(() => {
    $("#saved").textContent = "Saved locally";
    $("#saved").classList.remove("is-saving");
  }, 1200);
}

async function saveSetting(key, value) {
  await chrome.storage.local.set({ [key]: value });
  showSaved();
}

function setView(view, { updateHash = true } = {}) {
  const resolved = VIEW_COPY[view] ? view : "protection";
  for (const panel of $$("[data-view-panel]")) {
    panel.hidden = panel.dataset.viewPanel !== resolved;
  }
  for (const button of $$(".nav-item")) {
    const active = button.dataset.view === resolved;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const copy = VIEW_COPY[resolved];
  $("#sidebar-title").textContent = copy.title;
  $("#sidebar-intro").textContent = copy.intro;
  document.title = copy.documentTitle;
  if (updateHash && location.hash !== `#${resolved}`) {
    history.replaceState(null, "", `#${resolved}`);
  }
  if (resolved === "insights") renderInsights();
  if (resolved === "data") renderHistory();
}

function renderSites(sites) {
  const container = $("#options-sites");
  container.replaceChildren();
  for (const site of sites) {
    const row = document.createElement("div");
    row.className = "site-row";

    const identity = document.createElement("div");
    identity.className = "site-identity";
    const letter = document.createElement("span");
    letter.className = "site-letter";
    letter.textContent = site.label.charAt(0).toUpperCase();
    const name = document.createElement("span");
    name.className = "site-name";
    name.textContent = site.label;
    const host = document.createElement("span");
    host.className = "site-host";
    host.textContent = site.host;
    name.append(host);
    identity.append(letter, name);

    const switchLabel = document.createElement("label");
    switchLabel.className = "switch";
    switchLabel.setAttribute("aria-label", `Protect ${site.label}`);
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = site.enabled;
    const track = document.createElement("span");
    track.className = "switch-track";
    switchLabel.append(toggle, track);

    const remove = document.createElement("button");
    remove.className = "remove-site";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${site.label}`);

    toggle.addEventListener("change", async () => {
      const updated = sites.map((item) =>
        item.host === site.host ? { ...item, enabled: toggle.checked } : item
      );
      await saveSetting("protectedSites", updated);
      insightsData.protectedSites = updated;
      renderSites(updated);
    });
    remove.addEventListener("click", async () => {
      const updated = sites.filter((item) => item.host !== site.host);
      await saveSetting("protectedSites", updated);
      insightsData.protectedSites = updated;
      renderSites(updated);
    });

    row.append(identity, switchLabel, remove);
    container.append(row);
  }
}

function renderIntentions(intentions) {
  const container = $("#intentions");
  container.replaceChildren();
  if (!intentions.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Your choices will appear here, quietly.";
    container.append(empty);
    return;
  }
  for (const item of intentions.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "history-row";
    const text = document.createElement("p");
    text.textContent = item.text;
    const when = document.createElement("small");
    when.textContent = `${new Date(item.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    })} · ${item.host}`;
    row.append(text, when);
    container.append(row);
  }
}

function renderSessionHistory() {
  const container = $("#session-history");
  container.replaceChildren();
  const sessions = [...(insightsData.focusSessions || [])]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 14);
  if (!sessions.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Completed focus sessions will appear here.";
    container.append(empty);
    return;
  }
  for (const session of sessions) {
    const row = document.createElement("div");
    row.className = "history-row";
    const title = document.createElement("p");
    title.textContent = session.intention || "Focused session";
    const meta = document.createElement("small");
    const status = session.completed ? "completed" : "ended early";
    const source = session.source === "routine" ? " · routine" : "";
    meta.textContent = `${new Date(session.startedAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    })} · ${formatDuration(session.focusedSeconds || 0)} · ${status}${source}`;
    row.append(title, meta);
    container.append(row);
  }
}

function renderHistory() {
  if (!insightsData) return;
  renderSessionHistory();
  renderIntentions(insightsData.intentions || []);
}

function renderRoutineSites(selectedHosts = []) {
  const container = $("#routine-sites");
  const selected = new Set(selectedHosts);
  container.replaceChildren();
  for (const site of insightsData.protectedSites || []) {
    const label = document.createElement("label");
    label.className = "routine-site-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = site.host;
    input.checked = selected.has(site.host);
    const name = document.createElement("span");
    name.textContent = site.label;
    const host = document.createElement("small");
    host.textContent = site.host;
    label.append(input, name, host);
    container.append(label);
  }
}

function updateAutomaticNote() {
  const automatic =
    $('input[name="routine-behavior"]:checked')?.value === "automatic";
  const strict = $('input[name="routine-mode"]:checked')?.value === "strict";
  $("#automatic-note").hidden = !(automatic && strict);
}

function closeRoutineForm() {
  routineFormOpen = false;
  reviewingRoutineSuggestion = false;
  $("#routine-form").hidden = true;
  $("#routine-list").hidden = false;
  $("#new-routine").hidden = false;
  $("#routine-error").textContent = "";
  renderRoutineSuggestion();
}

function openRoutineForm(routine = null, { suggested = false } = {}) {
  const editing = Boolean(routine?.id);
  routineFormOpen = true;
  reviewingRoutineSuggestion = suggested;
  $("#routine-form").hidden = false;
  $("#routine-list").hidden = true;
  $("#routine-suggestion").hidden = true;
  $("#new-routine").hidden = true;
  $("#routine-id").value = editing ? routine.id : "";
  $("#routine-name").value = routine?.name || "";
  $("#routine-start").value = routine?.startTime || "09:00";
  $("#routine-end").value = routine?.endTime || "11:00";
  $("#routine-topic").value = routine?.topic || "";
  $("#routine-form-eyebrow").textContent = suggested
    ? "Suggested routine"
    : editing
      ? "Edit routine"
      : "New routine";
  $("#routine-form-title").textContent = suggested
    ? "Review the details"
    : editing
      ? routine.name
      : "Create a rhythm";
  for (const input of $$("#routine-days input")) {
    input.checked = routine
      ? (routine.days || []).includes(Number(input.value))
      : [1, 2, 3, 4, 5].includes(Number(input.value));
  }
  const mode = routine?.mode || "strict";
  const behavior = routine?.startBehavior || "ask";
  $(`input[name="routine-mode"][value="${mode}"]`).checked = true;
  $(`input[name="routine-behavior"][value="${behavior}"]`).checked = true;
  const defaultSites = (insightsData.protectedSites || [])
    .filter((site) => site.enabled)
    .map((site) => site.host);
  renderRoutineSites(routine?.siteHosts || defaultSites);
  updateAutomaticNote();
  $("#routine-error").textContent = "";
  $("#routine-name").focus();
}

function renderRoutineSuggestion() {
  const container = $("#routine-suggestion");
  currentRoutineSuggestion = null;
  if (
    routineFormOpen ||
    !insightsData ||
    !globalThis.StillRoutineSuggestions
  ) {
    container.hidden = true;
    return;
  }
  const suggestionCooldownAt =
    insightsData.dismissedRoutineSuggestions?.["*"] || 0;
  if (Date.now() - suggestionCooldownAt < SUGGESTION_DISMISS_MS) {
    container.hidden = true;
    return;
  }
  const suggestion = StillRoutineSuggestions.generate(insightsData);
  if (!suggestion) {
    container.hidden = true;
    return;
  }
  const dismissedAt =
    insightsData.dismissedRoutineSuggestions?.[suggestion.id] || 0;
  if (Date.now() - dismissedAt < SUGGESTION_DISMISS_MS) {
    container.hidden = true;
    return;
  }
  const knownSites = new Map(
    (insightsData.protectedSites || []).map((site) => [site.host, site.label])
  );
  const siteLabels = suggestion.siteHosts
    .map((host) => knownSites.get(host) || labelFromHost(host))
    .filter(Boolean);
  if (!siteLabels.length) {
    container.hidden = true;
    return;
  }

  currentRoutineSuggestion = suggestion;
  $("#suggestion-title").textContent = suggestion.title;
  $("#suggestion-copy").textContent = suggestion.copy;
  const mode =
    suggestion.routine.mode === "strict" ? "Strict focus" : "Mindful pauses";
  $("#suggestion-detail").textContent =
    `Suggested: ${mode} for ${siteLabels.join(", ")}`;
  $("#suggestion-evidence").textContent = suggestion.evidence;
  container.hidden = false;
}

function renderRoutines() {
  const container = $("#routine-list");
  container.replaceChildren();
  const routines = insightsData.routines || [];
  if (!routines.length) {
    const empty = document.createElement("div");
    empty.className = "routine-empty";
    const title = document.createElement("strong");
    title.textContent = "No routines yet";
    const copy = document.createElement("p");
    copy.textContent =
      "Create a recurring window for deep work, study, or a quieter evening online.";
    empty.append(title, copy);
    container.append(empty);
    return;
  }

  for (const routine of routines) {
    const row = document.createElement("article");
    row.className = "routine-row";
    row.classList.toggle("is-disabled", !routine.enabled);

    const switchLabel = document.createElement("label");
    switchLabel.className = "switch";
    switchLabel.setAttribute("aria-label", `${routine.enabled ? "Pause" : "Enable"} ${routine.name}`);
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = routine.enabled;
    const track = document.createElement("span");
    track.className = "switch-track";
    switchLabel.append(toggle, track);

    const copy = document.createElement("div");
    copy.className = "routine-copy";
    const name = document.createElement("strong");
    name.textContent = routine.name;
    const schedule = document.createElement("p");
    const mode = routine.mode === "strict" ? "Strict focus" : "Mindful pauses";
    const behavior =
      routine.startBehavior === "automatic" ? "starts automatically" : "asks first";
    schedule.textContent =
      `${formatRoutineDays(routine.days)} · ${formatRoutineTime(routine.startTime)}–${formatRoutineTime(routine.endTime)} · ${mode}, ${behavior}`;
    const siteCount = document.createElement("p");
    const count = (routine.siteHosts || []).length;
    siteCount.textContent = `${count} protected ${count === 1 ? "site" : "sites"}`;
    const next = document.createElement("p");
    next.className = "routine-next";
    next.textContent = formatNextOccurrence(routine);
    copy.append(name, schedule, siteCount, next);

    const actions = document.createElement("div");
    actions.className = "routine-actions";
    const edit = document.createElement("button");
    edit.className = "text-button";
    edit.type = "button";
    edit.textContent = "Edit";
    const remove = document.createElement("button");
    remove.className = "text-button danger";
    remove.type = "button";
    remove.textContent = "Remove";
    actions.append(edit, remove);

    toggle.addEventListener("change", async () => {
      const updated = routines.map((item) =>
        item.id === routine.id ? { ...item, enabled: toggle.checked } : item
      );
      await saveSetting("routines", updated);
    });
    edit.addEventListener("click", () => openRoutineForm(routine));
    remove.addEventListener("click", async () => {
      if (!confirm(`Remove “${routine.name}”?`)) return;
      await saveSetting(
        "routines",
        routines.filter((item) => item.id !== routine.id)
      );
    });

    row.append(switchLabel, copy, actions);
    container.append(row);
  }
}

function aggregateStats(range) {
  const total = { focusedSeconds: 0, sessions: 0, impulsesPaused: 0 };
  for (
    let date = new Date(range.start);
    date < range.end;
    date = addDays(date, 1)
  ) {
    const day = normalizedDay(insightsData.stats?.[localDateKey(date)]);
    total.focusedSeconds += day.focusedSeconds;
    total.sessions += day.sessions;
    total.impulsesPaused += day.impulsesPaused;
  }
  return total;
}

function focusBuckets(period, range) {
  const stats = insightsData.stats || {};
  const sessions = insightsData.focusSessions || [];
  if (period === "day") {
    const buckets = Array.from({ length: 6 }, (_, index) => ({
      label: index === 0 ? "12a" : index < 3 ? `${index * 4}a` : index === 3 ? "12p" : `${(index - 3) * 4}p`,
      value: 0,
      today: false
    }));
    const matchingSessions = sessions.filter((session) => inRange(session.startedAt, range));
    for (const session of matchingSessions) {
      const bucket = Math.min(5, Math.floor(new Date(session.startedAt).getHours() / 4));
      buckets[bucket].value += (session.focusedSeconds || 0) / 60;
    }
    if (!matchingSessions.length) {
      const today = normalizedDay(stats[localDateKey(range.start)]);
      const currentBucket = Math.min(5, Math.floor(new Date().getHours() / 4));
      buckets[currentBucket].value = today.focusedSeconds / 60;
    }
    return buckets;
  }

  const buckets = [];
  for (
    let date = new Date(range.start);
    date < range.end;
    date = addDays(date, 1)
  ) {
    const day = normalizedDay(stats[localDateKey(date)]);
    const isToday = localDateKey(date) === localDateKey();
    buckets.push({
      label:
        period === "week"
          ? date.toLocaleDateString(undefined, { weekday: "short" })
          : String(date.getDate()),
      secondary: period === "week" ? String(date.getDate()) : "",
      value: day.focusedSeconds / 60,
      today: isToday
    });
  }
  return buckets;
}

function renderTrend(period, range) {
  const svg = $("#trend-chart");
  const buckets = focusBuckets(period, range);
  const maxValue = Math.max(...buckets.map((bucket) => bucket.value), 0);
  const maxMinutes = Math.max(60, Math.ceil(maxValue / 30) * 30);
  const left = 70;
  const right = 880;
  const top = 25;
  const bottom = 187;
  const width = right - left;
  const height = bottom - top;
  const xFor = (index) =>
    buckets.length === 1 ? left + width / 2 : left + (index / (buckets.length - 1)) * width;
  const yFor = (value) => bottom - Math.min(1, value / maxMinutes) * height;
  const points = buckets.map((bucket, index) => ({
    ...bucket,
    x: xFor(index),
    y: yFor(bucket.value)
  }));
  const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${left},${bottom} ${line} ${right},${bottom}`;
  const labelEvery = period === "month" ? Math.max(1, Math.ceil(buckets.length / 7)) : 1;

  let markup = `
    <title>${escapeXml(PERIOD_COPY[period])} focus trend</title>
    <line class="grid-line" x1="${left}" y1="${top}" x2="${right}" y2="${top}"></line>
    <line class="grid-line" x1="${left}" y1="${top + height / 2}" x2="${right}" y2="${top + height / 2}"></line>
    <line class="axis-line" x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}"></line>
    <text class="axis-label" x="10" y="${top + 4}">${maxMinutes}m</text>
    <text class="axis-label" x="10" y="${top + height / 2 + 4}">${Math.round(maxMinutes / 2)}m</text>
    <text class="axis-label" x="24" y="${bottom + 4}">0m</text>
  `;
  if (points.some((point) => point.value > 0)) {
    markup += `<polygon class="trend-area" points="${area}"></polygon>`;
    markup += `<polyline class="trend-line" points="${line}"></polyline>`;
  }
  points.forEach((point, index) => {
    if (point.value > 0) {
      markup += `<circle class="trend-dot" cx="${point.x}" cy="${point.y}" r="6"></circle>`;
    }
    if (index % labelEvery !== 0 && index !== points.length - 1 && !point.today) return;
    const klass = point.today ? "date-label today" : "date-label";
    markup += `<text class="${klass}" text-anchor="middle" x="${point.x}" y="213">${escapeXml(point.label)}</text>`;
    if (point.secondary) {
      markup += `<text class="${klass}" text-anchor="middle" x="${point.x}" y="231">${escapeXml(point.secondary)}</text>`;
    }
    if (point.today && period === "week") {
      markup += `<rect class="today-pill" x="${point.x - 30}" y="236" width="60" height="25" rx="8"></rect>`;
      markup += `<text class="today-pill-label" text-anchor="middle" x="${point.x}" y="253">Today</text>`;
    }
  });
  svg.innerHTML = markup;
}

function timingBucket(timestamp) {
  const hour = new Date(timestamp).getHours();
  if (hour < 12) return 0;
  if (hour < 18) return 1;
  return 2;
}

function focusTimingBucket(timestamp) {
  return timingBucket(timestamp);
}

function timingName(index) {
  return ["morning", "afternoon", "evening"][index];
}

function renderDistribution(range) {
  const events = (insightsData.impulseEvents || []).filter((event) =>
    inRange(event.createdAt, range)
  );
  const counts = [0, 0, 0];
  for (const event of events) counts[timingBucket(event.createdAt)] += 1;
  const total = counts.reduce((sum, value) => sum + value, 0);
  const percentages = total
    ? counts.map((value) => Math.round((value / total) * 100))
    : [34, 33, 33];
  if (total) percentages[1] += 100 - percentages.reduce((sum, value) => sum + value, 0);
  const peak = total ? counts.indexOf(Math.max(...counts)) : -1;
  const bar = $("#distribution-bar");
  bar.style.gridTemplateColumns = percentages.map((value) => `${value}%`).join(" ");
  bar.replaceChildren();
  percentages.forEach((value, index) => {
    const segment = document.createElement("span");
    segment.textContent = total ? `${value}%` : "—";
    segment.classList.toggle("peak", index === peak);
    bar.append(segment);
  });

  const matchingSessions = (insightsData.focusSessions || []).filter((session) =>
    inRange(session.startedAt, range)
  );
  const focusByTime = [0, 0, 0];
  for (const session of matchingSessions) {
    focusByTime[focusTimingBucket(session.startedAt)] += session.focusedSeconds || 0;
  }
  if (!events.length && !matchingSessions.length) {
    $("#insight-copy").textContent = "Still is learning when focus and distraction show up.";
    return;
  }
  const focusPeak = focusByTime.some(Boolean)
    ? focusByTime.indexOf(Math.max(...focusByTime))
    : -1;
  if (focusPeak >= 0 && peak >= 0) {
    $("#insight-copy").textContent =
      `Your longest focus happens in the ${timingName(focusPeak)}, while distractions peak in the ${timingName(peak)}.`;
  } else if (peak >= 0) {
    $("#insight-copy").textContent =
      `Distractions show up most often in the ${timingName(peak)}.`;
  } else {
    $("#insight-copy").textContent = "Your focus pattern will become clearer with a few more sessions.";
  }
}

function aggregateSiteActivity(range) {
  const rows = new Map();
  for (const site of insightsData.protectedSites || []) {
    rows.set(site.host, {
      host: site.host,
      label: site.label,
      impulses: 0,
      usageSeconds: 0
    });
  }
  for (
    let date = new Date(range.start);
    date < range.end;
    date = addDays(date, 1)
  ) {
    const day = insightsData.siteStats?.[localDateKey(date)] || {};
    for (const [host, activity] of Object.entries(day)) {
      const site = rows.get(host) || {
        host,
        label: labelFromHost(host),
        impulses: 0,
        usageSeconds: 0
      };
      site.impulses += activity.impulses || 0;
      site.usageSeconds += activity.usageSeconds || 0;
      rows.set(host, site);
    }
  }
  return Array.from(rows.values()).sort(
    (a, b) =>
      b.impulses - a.impulses ||
      b.usageSeconds - a.usageSeconds ||
      a.label.localeCompare(b.label)
  );
}

function renderSiteActivity(range) {
  const body = $("#site-activity-body");
  body.replaceChildren();
  const rows = aggregateSiteActivity(range);
  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = "Add a protected site to begin seeing its activity.";
    tr.append(td);
    body.append(tr);
    return;
  }
  for (const site of rows) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = site.label;
    const impulses = document.createElement("td");
    impulses.textContent = String(site.impulses);
    const usage = document.createElement("td");
    usage.textContent = formatUsage(site.usageSeconds);
    tr.append(name, impulses, usage);
    body.append(tr);
  }
}

function renderInsights() {
  if (!insightsData) return;
  const range = rangeForPeriod(currentPeriod);
  const totals = aggregateStats(range);
  $("#period-title").textContent = PERIOD_COPY[currentPeriod];
  $("#period-range").textContent = formatRange(range.start, range.end, currentPeriod);
  $("#site-period-copy").textContent =
    `Activity during ${formatRange(range.start, range.end, currentPeriod)}`;
  $("#metric-focus").textContent = formatDuration(totals.focusedSeconds);
  $("#metric-sessions").textContent = String(totals.sessions);
  $("#metric-impulses").textContent = String(totals.impulsesPaused);
  for (const button of $$("[data-period]")) {
    const active = button.dataset.period === currentPeriod;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  renderTrend(currentPeriod, range);
  renderDistribution(range);
  const insightRoutine = $("#insight-routine");
  if (currentRoutineSuggestion) {
    const suggestion = currentRoutineSuggestion;
    const days = formatRoutineDays(suggestion.routine.days);
    const timeRange = formatRoutineTimeRange(
      suggestion.routine.startTime,
      suggestion.routine.endTime
    );
    $("#insight-routine-title").textContent = `${days} · ${timeRange}`;
    $("#insight-routine-reason").textContent =
      `You visit distracting sites about ${Math.max(2, Math.round(suggestion.lift))}× ` +
      "more often during this time.";
    insightRoutine.hidden = false;
  } else {
    insightRoutine.hidden = true;
  }
  renderSiteActivity(range);
}

async function render() {
  insightsData = await chrome.storage.local.get([
    "mindfulMode",
    "strictFocus",
    "pauseSeconds",
    "protectedSites",
    "stats",
    "siteStats",
    "impulseEvents",
    "focusSessions",
    "intentions",
    "routines",
    "dismissedRoutineSuggestions"
  ]);
  $("#mindful-mode").checked = insightsData.mindfulMode !== false;
  $("#strict-focus").checked = insightsData.strictFocus !== false;
  $("#pause-seconds").value = String(insightsData.pauseSeconds || 8);
  renderSites(insightsData.protectedSites || []);
  renderRoutineSuggestion();
  renderRoutines();
  renderHistory();
  setView(location.hash.slice(1) || "protection", { updateHash: false });
}

$("#mindful-mode").addEventListener("change", (event) =>
  saveSetting("mindfulMode", event.target.checked)
);
$("#strict-focus").addEventListener("change", (event) =>
  saveSetting("strictFocus", event.target.checked)
);
$("#pause-seconds").addEventListener("change", (event) =>
  saveSetting("pauseSeconds", Number(event.target.value))
);

$("#new-routine").addEventListener("click", () => openRoutineForm());
$("#cancel-routine").addEventListener("click", closeRoutineForm);
$("#cancel-routine-top").addEventListener("click", closeRoutineForm);

for (const input of $$('input[name="routine-mode"], input[name="routine-behavior"]')) {
  input.addEventListener("change", updateAutomaticNote);
}

$("#review-suggestion").addEventListener("click", () => {
  if (!currentRoutineSuggestion) return;
  openRoutineForm(currentRoutineSuggestion.routine, { suggested: true });
});

$("#insight-routine-link").addEventListener("click", () => {
  if (!currentRoutineSuggestion) return;
  const suggestion = currentRoutineSuggestion;
  setView("routines");
  openRoutineForm(suggestion.routine, { suggested: true });
});

$("#dismiss-suggestion").addEventListener("click", async () => {
  if (!currentRoutineSuggestion) return;
  const dismissedRoutineSuggestions = {
    ...(insightsData.dismissedRoutineSuggestions || {}),
    [currentRoutineSuggestion.id]: Date.now(),
    "*": Date.now()
  };
  insightsData.dismissedRoutineSuggestions = dismissedRoutineSuggestions;
  renderRoutineSuggestion();
  await saveSetting("dismissedRoutineSuggestions", dismissedRoutineSuggestions);
});

$("#routine-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const acceptedSuggestion = reviewingRoutineSuggestion;
  const name = $("#routine-name").value.trim();
  const days = $$("#routine-days input:checked").map((input) => Number(input.value));
  const startTime = $("#routine-start").value;
  const endTime = $("#routine-end").value;
  const siteHosts = $$("#routine-sites input:checked").map((input) => input.value);
  if (!name) {
    $("#routine-error").textContent = "Give this routine a name.";
    return;
  }
  if (!days.length) {
    $("#routine-error").textContent = "Choose at least one day.";
    return;
  }
  if (!startTime || !endTime || endTime <= startTime) {
    $("#routine-error").textContent = "End time must be later than start time.";
    return;
  }
  if (!siteHosts.length) {
    $("#routine-error").textContent = "Choose at least one protected site.";
    return;
  }

  const existingId = $("#routine-id").value;
  const existing = (insightsData.routines || []).find(
    (routine) => routine.id === existingId
  );
  const routine = {
    id: existingId || routineId(),
    name,
    days,
    startTime,
    endTime,
    mode: $('input[name="routine-mode"]:checked').value,
    startBehavior: $('input[name="routine-behavior"]:checked').value,
    topic: $("#routine-topic").value.trim(),
    siteHosts,
    enabled: existing?.enabled ?? true
  };
  const routines = existing
    ? (insightsData.routines || []).map((item) =>
        item.id === existing.id ? routine : item
      )
    : [...(insightsData.routines || []), routine];
  insightsData.routines = routines;
  if (acceptedSuggestion) {
    insightsData.dismissedRoutineSuggestions = {
      ...(insightsData.dismissedRoutineSuggestions || {}),
      "*": Date.now()
    };
  }
  closeRoutineForm();
  if (acceptedSuggestion) {
    await chrome.storage.local.set({
      routines,
      dismissedRoutineSuggestions: insightsData.dismissedRoutineSuggestions
    });
    showSaved();
  } else {
    await saveSetting("routines", routines);
  }
});

$("#add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const host = normalizeInput($("#new-site").value);
  if (!validHost(host)) {
    $("#form-error").textContent = "Enter a domain such as example.com";
    return;
  }
  const { protectedSites = [] } = await chrome.storage.local.get("protectedSites");
  if (protectedSites.some((site) => site.host === host)) {
    $("#form-error").textContent = "That site is already in your list.";
    return;
  }
  const updated = [...protectedSites, { host, label: labelFromHost(host), enabled: true }];
  await saveSetting("protectedSites", updated);
  insightsData.protectedSites = updated;
  $("#new-site").value = "";
  $("#form-error").textContent = "";
  renderSites(updated);
});

for (const button of $$("[data-view]")) {
  button.addEventListener("click", () => setView(button.dataset.view));
}

for (const button of $$("[data-period]")) {
  button.addEventListener("click", () => {
    currentPeriod = button.dataset.period;
    renderInsights();
  });
}

window.addEventListener("hashchange", () =>
  setView(location.hash.slice(1) || "protection", { updateHash: false })
);

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "local") render();
  });
}

render();
