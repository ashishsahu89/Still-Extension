let selectedMinutes = 25;
let timerId;
let exitTimerId;
let activeStrict = true;

const $ = (selector) => document.querySelector(selector);

function dateKey() {
  return new Date().toLocaleDateString("en-CA");
}

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizeHost(host) {
  return host.replace(/^www\./, "").toLowerCase();
}

function labelFromHost(host) {
  const root = host.split(".")[0];
  return root.charAt(0).toUpperCase() + root.slice(1);
}

async function render() {
  const data = await chrome.storage.local.get([
    "protectedSites",
    "focus",
    "stats",
    "strictFocus"
  ]);
  const focusActive = data.focus?.endAt > Date.now();
  renderSites(data.protectedSites || [], focusActive);
  renderStats(data.stats || {});
  renderFocus(data.focus, data.strictFocus);
}

function renderSites(sites, focusActive = false) {
  const list = $("#site-list");
  list.replaceChildren();
  const visible = sites.slice(0, 5);
  for (const site of visible) {
    const row = document.createElement("div");
    row.className = "site-row";
    row.innerHTML = `
      <span class="site-icon">${site.label.charAt(0).toUpperCase()}</span>
      <span class="site-name">${site.label}</span>
      <label class="switch" aria-label="Protect ${site.label}">
        <input type="checkbox" ${site.enabled ? "checked" : ""} />
        <span class="switch-track"></span>
      </label>
    `;
    const toggle = row.querySelector("input");
    toggle.disabled = focusActive;
    if (focusActive) toggle.title = "Changes are available after this focus session";
    toggle.addEventListener("change", async (event) => {
      const current = await chrome.storage.local.get("protectedSites");
      const updated = current.protectedSites.map((item) =>
        item.host === site.host ? { ...item, enabled: event.target.checked } : item
      );
      await chrome.storage.local.set({ protectedSites: updated });
      renderSites(updated);
    });
    list.append(row);
  }
  const enabled = sites.filter((site) => site.enabled).length;
  $("#site-count").textContent = `${enabled} active`;
  $("#add-current").disabled = focusActive;
  $("#add-current").title = focusActive
    ? "Changes are available after this focus session"
    : "";
}

function renderStats(stats) {
  const today = stats[dateKey()] || { focusedMinutes: 0, impulsesPaused: 0 };
  $("#today-summary").textContent =
    `Today · ${today.focusedMinutes}m focused · ${today.impulsesPaused} impulses paused`;
}

function renderFocus(focus, strictFocus = true) {
  const active = focus?.endAt > Date.now();
  activeStrict = active ? focus.strict ?? strictFocus !== false : strictFocus !== false;
  $("#ready-view").hidden = active;
  $("#active-view").hidden = !active;
  $("#strict-exit-view").hidden = true;
  $("#protected-section").hidden = false;
  if (!active) {
    clearInterval(timerId);
    clearInterval(exitTimerId);
    return;
  }
  $("#active-intention").textContent = focus.intention || "One thing at a time.";
  const tick = () => {
    const remaining = focus.endAt - Date.now();
    $("#active-time").textContent = formatTime(remaining);
    if (remaining <= 0) {
      clearInterval(timerId);
      setTimeout(render, 250);
    }
  };
  tick();
  clearInterval(timerId);
  timerId = setInterval(tick, 1000);
}

$("#minus").addEventListener("click", () => {
  selectedMinutes = Math.max(5, selectedMinutes - 5);
  $("#minutes").textContent = selectedMinutes;
});

$("#plus").addEventListener("click", () => {
  selectedMinutes = Math.min(120, selectedMinutes + 5);
  $("#minutes").textContent = selectedMinutes;
});

$("#begin-focus").addEventListener("click", async () => {
  const intention = $("#intention").value.trim();
  await chrome.runtime.sendMessage({
    type: "START_FOCUS",
    minutes: selectedMinutes,
    intention
  });
  render();
});

$("#end-focus").addEventListener("click", async () => {
  if (!activeStrict) {
    await chrome.runtime.sendMessage({
      type: "STOP_FOCUS",
      reason: "Ended early"
    });
    render();
    return;
  }
  const response = await chrome.runtime.sendMessage({ type: "REQUEST_FOCUS_EXIT" });
  if (response?.ok) showStrictExit(response.unlockAt);
});

function showStrictExit(unlockAt) {
  clearInterval(timerId);
  $("#active-view").hidden = true;
  $("#protected-section").hidden = true;
  $("#strict-exit-view").hidden = false;
  $("#emergency-panel").hidden = true;
  $("#show-emergency").setAttribute("aria-expanded", "false");
  $("#exit-reason").value = "";

  const update = () => {
    const remainingSeconds = Math.max(0, Math.ceil((unlockAt - Date.now()) / 1000));
    const reasonReady = $("#exit-reason").value.trim().length >= 3;
    $("#confirm-end-focus").disabled = remainingSeconds > 0 || !reasonReady;
    $("#exit-status").textContent = remainingSeconds > 0
      ? `Exit unlocks in 0:${String(remainingSeconds).padStart(2, "0")}`
      : reasonReady
        ? "Exit is available."
        : "Exit is available. Name your reason to continue.";
    if (remainingSeconds <= 0) clearInterval(exitTimerId);
  };

  clearInterval(exitTimerId);
  exitTimerId = setInterval(update, 250);
  update();
  $("#exit-reason").focus();
}

$("#exit-reason").addEventListener("input", () => {
  if ($("#exit-status").textContent.startsWith("Exit is available")) {
    $("#confirm-end-focus").disabled = $("#exit-reason").value.trim().length < 3;
    $("#exit-status").textContent = $("#confirm-end-focus").disabled
      ? "Exit is available. Name your reason to continue."
      : "Exit is available.";
  }
});

$("#confirm-end-focus").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({
    type: "STOP_FOCUS",
    reason: $("#exit-reason").value.trim()
  });
  if (response?.ok) render();
  else if (response?.unlockAt) showStrictExit(response.unlockAt);
});

$("#keep-focusing").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CANCEL_FOCUS_EXIT" });
  render();
});

$("#show-emergency").addEventListener("click", () => {
  const panel = $("#emergency-panel");
  panel.hidden = !panel.hidden;
  $("#show-emergency").setAttribute("aria-expanded", String(!panel.hidden));
  if (!panel.hidden) $("#confirm-emergency").focus();
});

$("#cancel-emergency").addEventListener("click", () => {
  $("#emergency-panel").hidden = true;
  $("#show-emergency").setAttribute("aria-expanded", "false");
  $("#show-emergency").focus();
});

$("#confirm-emergency").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({
    type: "STOP_FOCUS",
    emergency: true,
    confirmed: true,
    reason: $("#exit-reason").value.trim() || "Emergency exit"
  });
  if (response?.ok) render();
});

$("#open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

$("#add-current").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("http")) return;
  const host = normalizeHost(new URL(tab.url).hostname);
  const data = await chrome.storage.local.get("protectedSites");
  const sites = data.protectedSites || [];
  const existing = sites.find((site) => site.host === host);
  if (existing) existing.enabled = true;
  else sites.push({ host, label: labelFromHost(host), enabled: true });
  await chrome.storage.local.set({ protectedSites: sites });
  renderSites(sites);
});

render();
