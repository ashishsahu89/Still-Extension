# Still

Still is a private, local-first Chrome extension for interrupting autopilot browsing and protecting focused work.

## What it has

- A deliberate pause before distraction and intention-setting
- Reliable site protection and timed focus blocks
- Low-friction screen-time awareness
- Calm growing visual, without coins, streak anxiety, or punishment

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this `still-focus-extension` folder.
5. Pin **Still** from Chrome’s extensions menu.

No build step, account, server, or Chrome Web Store upload is required.

## Core flow

1. Choose a focus duration and optionally name what matters.
2. Still protects enabled sites during the session.
3. Outside sessions, Mindful Pauses can continue interrupting habitual visits.
4. After one breath, return to focus or intentionally continue for five minutes.
5. During intentional access, a compact on-page timer shows the remaining time and offers **End now**.
6. When the pass expires, Still automatically returns every open tab for that protected site to the intervention screen—even if the page timer was throttled in a background tab.
7. Strict focus snapshots the protected-site list for the session. Ending early requires a reason and a 20-second cooldown, while an explicit emergency exit always remains available.

When focus begins, Still also redirects protected sites that were already open and watches single-page-app history changes such as YouTube navigation.

## Settings and insights

Settings now open into a small navigation system:

- **Insights:** Day, week, and month views for focused time, sessions, impulses, active-tab categories, leading sites, distraction timing, and protected-site activity
- **Protection:** Focus behavior, strictness, pause length, and the protected-site list
- **Routines:** Recurring protection windows with chosen days, times, sites, mode, topic, and ask-first or automatic start
- **Data & privacy:** Active-tab measurement controls, optional on-device intelligence when the browser provides it, focus-session history, recent intentions, and a clear explanation of local storage

Routines notify you five minutes before they begin with **Start now** and **Skip today**. They never replace an active focus session, and opening the browser partway through an automatic routine starts only the remaining scheduled time. Protected-site usage reflects intentional-access time granted through Still’s five-minute passes.

Still’s category insights measure only the domain in the active tab of the browser’s focused window. Measurement pauses when the browser loses focus, the user is idle, or the setting is turned off. Still never records page paths, titles, or content. Daily domain totals are retained for up to 550 days; bounded domain-only occurrences are retained for up to 90 days so time-of-day patterns can be calculated.

Categories work without AI through a bundled taxonomy and conservative hostname rules. When a browser exposes a compatible built-in Prompt API, users can optionally enable on-device intelligence to suggest categories for unfamiliar domains and write a short explanation of aggregated patterns. Still checks the capability at runtime: unsupported browsers see no AI controls, while devices with the API but without an available model see a quiet note in Data & privacy. The model runs on-device. Still passes only domain, duration, occurrence count, and time-of-day totals to it; no data is sent to Still or another server.

After enough local activity, Still can suggest a routine for a repeated distraction window. Suggestions use a transparent 28-day calculation based on impulse frequency, consistency across active days, recency, existing routines, and successful focus sessions in the same window. The suggestion appears in Routines and alongside **When distraction shows up** in Insights. Still never creates the routine automatically: **Review routine** opens a pre-filled form, while **Not now** pauses suggestions for two weeks.

## Permissions

- `storage`: stores your settings and private local history
- `tabs` and `webNavigation`: notices visits to sites you chose and replaces them with the pause page
- `idle`: pauses active-tab measurement when the computer is not in use
- `alarms`: completes focus timers reliably while the popup is closed
- `notifications`: gives routine reminders and the Start now / Skip today actions
- `<all_urls>`: required to support any domain you add; Still never sends browsing data anywhere
