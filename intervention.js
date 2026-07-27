const params = new URLSearchParams(location.search);
const rawTargetUrl = params.get("url");
const siteHost = String(params.get("host") || "").toLowerCase();
const siteLabel = params.get("label") || "this site";
const requestedFocus = params.get("focus") === "true";
const focusEndAt = Number(params.get("focusEndAt")) || 0;
let focusActive = false;
let strictFocus = params.get("strict") !== "false";
let targetUrl = null;

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
document.querySelector("#site-name").textContent = siteLabel;

function matchesProtected(host, protectedHost) {
  return Boolean(protectedHost) &&
    (host === protectedHost || host.endsWith(`.${protectedHost}`));
}

function validatedTargetUrl(value, expectedHost) {
  if (!value || !expectedHost) return null;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return matchesProtected(parsed.hostname.toLowerCase(), expectedHost)
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function dateKey() {
  return new Date().toLocaleDateString("en-CA");
}

function remainingFocusCopy(endAt) {
  const milliseconds = Math.max(0, endAt - Date.now());
  if (milliseconds < 60000) return "Locked · less than a minute remaining";
  const minutes = Math.ceil(milliseconds / 60000);
  return `Locked · ${minutes} ${minutes === 1 ? "minute" : "minutes"} remaining`;
}

function formatFocusDuration(milliseconds, rounding = "floor") {
  const seconds = Math.max(
    0,
    Math[rounding](milliseconds / 1000)
  );
  if (seconds < 60) {
    return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  }
  const minutes = Math[rounding](seconds / 60);
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const hourCopy = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  if (!remainingMinutes) return hourCopy;
  return `${hourCopy} ${remainingMinutes} ${
    remainingMinutes === 1 ? "minute" : "minutes"
  }`;
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
  interventionHeading.setAttribute(
    "aria-label",
    `You are focussed on: ${topic || "this focus session"}`
  );
  interventionHeading.classList.add("focus-heading");

  if (!focus?.startedAt || !focus?.endAt) return;
  focusReminder.hidden = false;

  const updateProgress = () => {
    focusElapsed.textContent = formatFocusDuration(
      Date.now() - focus.startedAt,
      "floor"
    );
    const remainingCopy = formatFocusDuration(
      focus.endAt - Date.now(),
      "ceil"
    );
    focusRemaining.textContent = remainingCopy;
    focusRemainingVerb.textContent =
      /^(1 second|1 minute|1 hour)$/.test(remainingCopy) ? "remains" : "remain";
  };
  updateProgress();
  setInterval(updateProgress, 1000);
}

async function initialize() {
  const data = await chrome.storage.local.get(["pauseSeconds", "stats", "focus"]);
  focusActive = data.focus?.endAt > Date.now();
  strictFocus = focusActive
    ? data.focus?.strict !== false
    : params.get("strict") !== "false";
  targetUrl = validatedTargetUrl(rawTargetUrl, siteHost);

  if (requestedFocus && !focusActive && !targetUrl) {
    await chrome.runtime.sendMessage({ type: "CLEAR_STALE_STRICT_RULES" });
    if (history.length > 1) history.back();
    else location.replace("https://www.google.com/");
    return;
  }

  const seconds = Math.max(3, Math.min(20, data.pauseSeconds || 8));
  const today = data.stats?.[dateKey()] || { focusedMinutes: 0 };
  document.querySelector("#today").textContent =
    `Today · ${today.focusedMinutes}m protected`;

  if (focusActive) showFocusReminder(data.focus);

  if (focusActive && strictFocus) {
    intention.placeholder = "What will you return to?";
    continueButton.hidden = true;
    lockStatus.hidden = false;
    const endAt = data.focus?.endAt || focusEndAt;
    lockCopy.textContent = endAt
      ? remainingFocusCopy(endAt)
      : "Locked during your focus session";
  }

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
    intentions.unshift({
      text: intention.value.trim(),
      host: "focus",
      createdAt: Date.now()
    });
    intentions.splice(30);
    await chrome.storage.local.set({ intentions });
  }
  if (history.length > 1) history.back();
  else location.replace("https://www.google.com/");
});

continueButton.addEventListener("click", async () => {
  if (!targetUrl || !siteHost) return;
  const response = await chrome.runtime.sendMessage({
    type: "ALLOW_SITE",
    host: siteHost,
    intention: intention.value.trim()
  });
  if (!response?.ok) {
    breathWord.textContent = "Still couldn’t start intentional time.";
    return;
  }
  location.replace(targetUrl);
});

intention.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (focusActive && strictFocus) {
    document.querySelector("#return-focus").click();
  } else if (!continueButton.disabled) {
    continueButton.click();
  }
});

initialize();
