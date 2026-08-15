const params = new URLSearchParams(location.search);
const rawTargetUrl = params.get("url");
const siteHost = String(params.get("host") || "").toLowerCase();
const siteLabel = params.get("label") || "this site";
const requestedFocus = params.get("focus") === "true";
const requestedState = params.get("state") || "pause";
const focusEndAt = Number(params.get("focusEndAt")) || 0;
const cooldownUntil = Number(params.get("cooldownUntil")) || 0;
const taskEligible = params.get("taskEligible") === "true";
const taskMinutes = Number(params.get("taskMinutes")) || 0;
let focusActive = false;
let strictFocus = params.get("strict") !== "false";
let targetUrl = null;
let selectedTaskMinutes = 15;

const pauseView = document.querySelector("#pause-view");
const expiryView = document.querySelector("#expiry-view");
const countdown = document.querySelector("#countdown");
const breathWord = document.querySelector("#breath-word");
const breathCopy = document.querySelector(".breath-copy");
const breathStage = document.querySelector(".breath-stage");
const continueButton = document.querySelector("#continue");
const intention = document.querySelector("#intention");
const lockStatus = document.querySelector("#lock-status");
const lockCopy = document.querySelector("#lock-copy");
const focusReminder = document.querySelector("#focus-reminder");
const interventionHeading = document.querySelector("#intervention-heading");
const focusElapsed = document.querySelector("#focus-elapsed");
const focusRemaining = document.querySelector("#focus-remaining");
const focusRemainingVerb = document.querySelector("#focus-remaining-verb");
const choice = document.querySelector(".choice");
const expiryHeading = document.querySelector("#expiry-heading");
const expiryCopy = document.querySelector("#expiry-copy");
const expiryFocus = document.querySelector("#expiry-focus");
const expiryReturn = document.querySelector("#expiry-return");
const openTask = document.querySelector("#open-task");
const taskForm = document.querySelector("#task-form");
const taskIntention = document.querySelector("#task-intention");
const taskStatus = document.querySelector("#task-status");
const expiryNote = document.querySelector("#expiry-note");
const startTask = document.querySelector("#start-task");
document.querySelector("#site-name").textContent = siteLabel;

function matchesProtected(host, protectedHost) {
  return Boolean(protectedHost) && (host === protectedHost || host.endsWith(`.${protectedHost}`));
}

function validatedTargetUrl(value, expectedHost) {
  if (!value || !expectedHost) return null;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return matchesProtected(parsed.hostname.toLowerCase(), expectedHost) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function dateKey() {
  return new Date().toLocaleDateString("en-CA");
}

function formatClock(timestamp) {
  if (!timestamp) return "later";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(timestamp)
  );
}

function remainingFocusCopy(endAt) {
  const milliseconds = Math.max(0, endAt - Date.now());
  if (milliseconds < 60000) return "Locked · less than a minute remaining";
  const minutes = Math.ceil(milliseconds / 60000);
  return `Locked · ${minutes} ${minutes === 1 ? "minute" : "minutes"} remaining`;
}

function formatFocusDuration(milliseconds, rounding = "floor") {
  const seconds = Math.max(0, Math[rounding](milliseconds / 1000));
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math[rounding](seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const hourCopy = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return remainingMinutes ? `${hourCopy} ${remainingMinutes} ${remainingMinutes === 1 ? "minute" : "minutes"}` : hourCopy;
}

function showFocusReminder(focus) {
  const topic = String(focus?.intention || "").trim();
  const headingLabel = document.createElement("span");
  headingLabel.className = "focus-heading-label";
  headingLabel.textContent = "You are focussed on:";
  const headingTopic = document.createElement("span");
  headingTopic.className = "focus-heading-topic";
  headingTopic.textContent = topic || "This focus session";
  interventionHeading.replaceChildren(headingLabel, headingTopic);
  interventionHeading.setAttribute("aria-label", `You are focussed on: ${topic || "this focus session"}`);
  interventionHeading.classList.add("focus-heading");

  if (!focus?.startedAt || !focus?.endAt) return;
  focusReminder.hidden = false;
  const updateProgress = () => {
    focusElapsed.textContent = formatFocusDuration(Date.now() - focus.startedAt, "floor");
    const remainingCopy = formatFocusDuration(focus.endAt - Date.now(), "ceil");
    focusRemaining.textContent = remainingCopy;
    focusRemainingVerb.textContent = /^(1 second|1 minute|1 hour)$/.test(remainingCopy) ? "remains" : "remain";
  };
  updateProgress();
  setInterval(updateProgress, 1000);
}

function showExpiryFocus(focus) {
  const topic = String(focus?.intention || "").trim() || "this focus session";
  const update = () => {
    const remaining = formatFocusDuration(focus.endAt - Date.now(), "ceil");
    expiryFocus.textContent = `You’re focused on: ${topic}. ${remaining} remaining.`;
  };
  expiryFocus.hidden = false;
  update();
  setInterval(update, 1000);
}

function showExpiryState(focus) {
  pauseView.hidden = true;
  expiryView.hidden = false;
  expiryFocus.hidden = true;
  openTask.hidden = true;
  openTask.textContent = `I need ${siteLabel} for a task`;
  taskForm.hidden = true;
  expiryNote.textContent = "";

  if (requestedState === "focus-break-ended") {
    expiryHeading.textContent = "Your break is over.";
    expiryCopy.textContent = "You chose one intentional break for this session. The rest of your focus time is protected.";
    expiryReturn.textContent = "Return to focus";
    expiryNote.textContent = `You can visit ${siteLabel} again when this focus session ends.`;
    showExpiryFocus(focus);
    return;
  }

  if (requestedState === "focus-break-used") {
    expiryHeading.textContent = "Your break is over.";
    expiryCopy.textContent = "You’ve already used your one intentional break. Your focus time is protected until this session ends.";
    expiryReturn.textContent = "Return to focus";
    showExpiryFocus(focus);
    return;
  }

  if (requestedState === "task-expired") {
    expiryHeading.textContent = `Your task time on ${siteLabel} is up.`;
    expiryCopy.textContent = taskMinutes
      ? `You set aside ${taskMinutes} intentional minutes. Give the task a moment to settle before coming back.`
      : "You set aside intentional time for this task. Give it a moment to settle before coming back.";
    expiryReturn.textContent = `Leave ${siteLabel}`;
    expiryNote.textContent = cooldownUntil ? `You can visit again at ${formatClock(cooldownUntil)}.` : "You can visit again later.";
    return;
  }

  if (requestedState === "cooldown") {
    expiryHeading.textContent = `Your time on ${siteLabel} is up.`;
    expiryCopy.textContent = cooldownUntil
      ? `You’ve already used your five intentional minutes. You can visit again at ${formatClock(cooldownUntil)}.`
      : "You’ve already used your five intentional minutes. Try again a little later.";
    expiryReturn.textContent = `Leave ${siteLabel}`;
    openTask.hidden = !taskEligible;
    return;
  }

  expiryHeading.textContent = `Your time on ${siteLabel} is up.`;
  expiryCopy.textContent = cooldownUntil
    ? `You chose five intentional minutes. You can visit again at ${formatClock(cooldownUntil)}.`
    : "You chose five intentional minutes.";
  expiryReturn.textContent = `Leave ${siteLabel}`;
  openTask.hidden = !taskEligible;
}

async function leaveProtectedSite() {
  // History can contain another Still intervention page (for example, the
  // five-minute expiry screen). Going back would trap the person in a loop.
  try {
    const tab = await chrome.tabs.getCurrent();
    if (Number.isInteger(tab?.id)) {
      await chrome.tabs.remove(tab.id);
      return;
    }
  } catch {
    // Fall through for the local preview or a browser that cannot close it.
  }

  // The preview is not an extension tab, so it cannot be closed. Never use
  // browser history as a fallback: an empty page is safer than another pause.
  location.replace("about:blank");
}

async function initialize() {
  const data = await chrome.storage.local.get(["pauseSeconds", "stats", "focus"]);
  focusActive = data.focus?.endAt > Date.now();
  strictFocus = focusActive ? data.focus?.strict !== false : params.get("strict") !== "false";
  targetUrl = validatedTargetUrl(rawTargetUrl, siteHost);

  if (requestedFocus && !focusActive && !targetUrl) {
    await chrome.runtime.sendMessage({ type: "CLEAR_STALE_STRICT_RULES" });
    leaveProtectedSite();
    return;
  }

  const today = data.stats?.[dateKey()] || { focusedMinutes: 0 };
  document.querySelector("#today").textContent = `Today · ${today.focusedMinutes}m protected`;

  if (requestedState !== "pause") {
    showExpiryState(data.focus);
    return;
  }

  if (focusActive) showFocusReminder(data.focus);
  if (focusActive && strictFocus) {
    intention.placeholder = "What will you return to?";
    continueButton.hidden = true;
    lockStatus.hidden = false;
    const endAt = data.focus?.endAt || focusEndAt;
    lockCopy.textContent = endAt ? remainingFocusCopy(endAt) : "Locked during your focus session";
  }

  const seconds = Math.max(3, Math.min(20, data.pauseSeconds || 8));
  let remaining = seconds;
  countdown.textContent = remaining;
  const timer = setInterval(() => {
    remaining -= 1;
    countdown.textContent = Math.max(0, remaining);
    breathWord.textContent = remaining > seconds / 2 ? "Breathe in" : "Breathe out";
    if (remaining <= 0) {
      clearInterval(timer);
      countdown.textContent = "";
      breathWord.textContent = "Pause complete";
      breathCopy.classList.add("is-complete");
      breathStage.classList.add("is-complete");
      choice.classList.remove("is-breathing");
      choice.classList.add("is-ready");
      intention.disabled = false;
      continueButton.disabled = focusActive && strictFocus;
      intention.focus();
    }
  }, 1000);
}

document.querySelector("#return-focus").addEventListener("click", async () => {
  if (intention.value.trim()) {
    const { intentions = [] } = await chrome.storage.local.get("intentions");
    intentions.unshift({ text: intention.value.trim(), host: "focus", createdAt: Date.now() });
    intentions.splice(30);
    await chrome.storage.local.set({ intentions });
  }
  leaveProtectedSite();
});

document.querySelector("#expiry-return").addEventListener("click", leaveProtectedSite);

continueButton.addEventListener("click", async () => {
  if (!targetUrl || !siteHost) return;
  const response = await chrome.runtime.sendMessage({
    type: "ALLOW_SITE",
    host: siteHost,
    intention: intention.value.trim()
  });
  if (!response?.ok) {
    breathWord.textContent = response?.reason === "focus-break-used"
      ? "Your one break is already used."
      : "Still couldn’t start intentional time.";
    return;
  }
  location.replace(targetUrl);
});

openTask.addEventListener("click", () => {
  taskForm.hidden = false;
  openTask.hidden = true;
  taskStatus.textContent = "";
  taskIntention.focus();
});

for (const button of document.querySelectorAll("[data-minutes]")) {
  button.addEventListener("click", () => {
    selectedTaskMinutes = Number(button.dataset.minutes) || 15;
    for (const option of document.querySelectorAll("[data-minutes]")) {
      option.setAttribute("aria-pressed", String(option === button));
    }
    startTask.textContent = `Start a ${selectedTaskMinutes} minute task`;
  });
}

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!targetUrl || !siteHost || !taskIntention.value.trim()) {
    taskIntention.reportValidity();
    return;
  }
  startTask.disabled = true;
  startTask.textContent = "Starting…";
  taskStatus.textContent = "";
  const response = await chrome.runtime.sendMessage({
    type: "START_TASK_ACCESS",
    host: siteHost,
    minutes: selectedTaskMinutes,
    intention: taskIntention.value.trim()
  });
  startTask.disabled = false;
  startTask.textContent = `Start a ${selectedTaskMinutes} minute task`;
  if (!response?.ok) {
    taskStatus.textContent = response?.reason === "task-not-available"
      ? "This task exception has already been used."
      : "Still couldn’t start this task.";
    return;
  }
  location.replace(targetUrl);
});

intention.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (focusActive && strictFocus) document.querySelector("#return-focus").click();
  else if (!continueButton.disabled) continueButton.click();
});

initialize();
