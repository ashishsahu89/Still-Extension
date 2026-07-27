(() => {
  const normalizeHost = (host) => host.replace(/^www\./, "").toLowerCase();
  const matchesProtected = (host, siteHost) =>
    host === siteHost || host.endsWith(`.${siteHost}`);

  function formatRemaining(milliseconds) {
    const total = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  async function initialize() {
    if (document.querySelector("#still-pass-countdown")) return;
    const data = await chrome.storage.local.get([
      "passes",
      "protectedSites",
      "focus",
      "activeRoutine"
    ]);
    const host = normalizeHost(location.hostname);
    const passEntries =
      data.passes && typeof data.passes === "object"
        ? Object.entries(data.passes)
        : [];
    const activePass = passEntries.find(
      ([passHost, passEndAt]) =>
        matchesProtected(host, passHost) && Number(passEndAt) > Date.now()
    );
    if (!activePass) return;
    const [passHost, endAt] = activePass;
    const availableSites = [
      ...(Array.isArray(data.focus?.protectedSites)
        ? data.focus.protectedSites
        : []),
      ...(Array.isArray(data.activeRoutine?.protectedSites)
        ? data.activeRoutine.protectedSites
        : []),
      ...(Array.isArray(data.protectedSites) ? data.protectedSites : [])
    ];
    const site =
      availableSites.find((item) => item?.host === passHost) ||
      { host: passHost, label: passHost };

    const hostElement = document.createElement("div");
    hostElement.id = "still-pass-countdown";
    hostElement.setAttribute("aria-label", "Still intentional access timer");
    const shadow = hostElement.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 2147483647;
          font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #20231f;
        }
        .timer {
          display: flex;
          align-items: center;
          gap: 9px;
          min-height: 42px;
          padding: 0 8px 0 12px;
          border: 1px solid rgba(73, 106, 81, 0.3);
          border-radius: 12px;
          background: rgba(247, 246, 242, 0.97);
          box-shadow: 0 8px 24px rgba(32, 35, 31, 0.14);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }
        .mark {
          position: relative;
          width: 18px;
          height: 18px;
          flex: 0 0 auto;
          border: 1.5px solid #496a51;
          border-radius: 50%;
          background:
            linear-gradient(#496a51, #496a51) center 10px / 1.5px 5px no-repeat;
        }
        .mark::before,
        .mark::after {
          content: "";
          position: absolute;
          top: 5px;
          width: 6px;
          height: 4px;
          background: #496a51;
        }
        .mark::before {
          left: 3px;
          border-radius: 6px 1px 6px 1px;
          transform: rotate(25deg);
        }
        .mark::after {
          right: 3px;
          border-radius: 1px 6px 1px 6px;
          transform: rotate(-25deg);
        }
        .copy {
          display: flex;
          align-items: baseline;
          gap: 7px;
          white-space: nowrap;
        }
        .label {
          color: #687067;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.01em;
        }
        .remaining {
          min-width: 33px;
          font-size: 13px;
          font-variant-numeric: tabular-nums;
          font-weight: 750;
        }
        button {
          min-height: 28px;
          padding: 0 9px;
          border: 0;
          border-radius: 7px;
          background: transparent;
          color: #496a51;
          font: 650 11px/1 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          cursor: pointer;
        }
        button:hover,
        button:focus-visible {
          outline: none;
          background: #e5ebe2;
        }
        .timer.expired .label {
          color: #496a51;
        }
        @media (max-width: 520px) {
          :host {
            top: 10px;
            right: 10px;
          }
          .label {
            display: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          * {
            transition: none !important;
          }
        }
      </style>
      <div class="timer">
        <span class="mark" aria-hidden="true"></span>
        <span class="copy">
          <span class="label">Intentional time</span>
          <strong class="remaining">${formatRemaining(endAt - Date.now())}</strong>
        </span>
        <button type="button">End now</button>
      </div>
    `;
    document.documentElement.append(hostElement);

    const timer = shadow.querySelector(".timer");
    const label = shadow.querySelector(".label");
    const remaining = shadow.querySelector(".remaining");
    const endButton = shadow.querySelector("button");
    let completed = false;
    let interval;

    async function expire(force = false) {
      if (completed) return;
      completed = true;
      clearInterval(interval);
      label.textContent = "Time is up";
      remaining.textContent = "0:00";
      timer.classList.add("expired");
      endButton.disabled = true;
      try {
        await chrome.runtime.sendMessage({
          type: "PASS_EXPIRED",
          host: site.host,
          url: location.href,
          force
        });
      } catch {
        hostElement.remove();
      }
    }

    function tick() {
      const milliseconds = endAt - Date.now();
      remaining.textContent = formatRemaining(milliseconds);
      if (milliseconds <= 0) expire(false);
    }

    endButton.addEventListener("click", () => expire(true));
    document.addEventListener("visibilitychange", tick);
    interval = setInterval(tick, 1000);
    tick();
  }

  initialize();
})();
