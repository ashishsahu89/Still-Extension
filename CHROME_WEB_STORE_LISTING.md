# Chrome Web Store listing draft

Use this copy in the Chrome Web Store dashboard. Keep the public privacy-policy URL pointed at the `PRIVACY_POLICY.md` file on the default branch until a dedicated policy site is available:

`https://github.com/ashishsahu89/still-focus-extension/blob/main/PRIVACY_POLICY.md`

## Store listing

### Name

Still — Focus on purpose

### Short description

Stay intentional online: pause distracting sites, protect focus, and organize open tabs locally.

### Detailed description

Still helps you browse with intention.

• Pause before habitual visits and choose what matters now.
• Protect focus sessions with clear, bounded access rules.
• See where active browsing time goes with local, domain-level Insights.
• Create routines for the times and sites that regularly pull you away.
• Organize open tabs into useful workstreams with one click.
• Keep linked tabs together as you browse.

Still is local-first. It has no account, ads, analytics, or Still-operated server. Focus settings, sessions, routines, and Insights stay in Chrome on this device. Remote AI is optional: if you connect a provider, Still sends only the tab titles and domains needed for organization, or aggregated domains and usage totals for Insights. Page contents, page paths, and full addresses are never sent. Local models stay on this computer.

Still is calm by design: no streaks, scores, or shame—just a small pause that helps you choose deliberately.

### Category

Productivity

### Language

English

## Single purpose

Still helps people stay intentional while browsing by pausing distracting sites and keeping focus work organized.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `alarms` | Keeps focus timers and scheduled routines reliable while the popup is closed. |
| `declarativeNetRequest` | Applies the protected-site rules that redirect a site to Still's pause or focus screen. |
| `favicon` | Reads the browser favicon used to choose a recognizable tab-group color. |
| `idle` | Pauses active-tab measurement when the computer is idle. |
| `notifications` | Shows routine reminders and the **Start now** / **Skip today** actions. |
| `scripting` | Injects Still's intervention and pass-timer behavior into a protected page when needed. |
| `storage` | Saves settings, routines, local Insights, focus history, and tab-organization state on this device. |
| `tabs` | Reads and updates the tabs you choose to protect or organize, including their titles and domains. |
| `tabGroups` | Creates, names, colors, collapses, and updates Chrome tab groups. |
| `webNavigation` | Detects navigations and history changes so protection and linked-tab behavior remain current. |
| `<all_urls>` | Supports any site you choose to protect and lets the one-click organizer work on ordinary web tabs in any domain. |

## Data disclosure

### Data Still handles

- **Web browsing activity:** active-tab domains, tab titles when organizing tabs, domain-level usage totals, visit counts, and time-of-day aggregates.
- **Authentication information:** an API key that you choose to enter for a remote model connection. It is stored locally in Chrome extension storage and sent only to that selected provider when a request runs.

Still does **not** handle page contents, full URLs or paths, passwords, payment information, health information, precise location, communications, or contact information.

### Transfers and use

Local data is used to provide Still's focus, protection, Insights, routines, and tab-organization features. Remote transfers happen only after the user explicitly configures and enables a remote AI provider. Requests go directly to that provider; Still does not operate a relay or sell data.

### Limited Use certification

Still's use of browsing activity and any authentication information is limited to providing or improving the user-facing features described in this listing, and to complying with applicable law. Still does not sell this data or use it for advertising, credit, lending, or unrelated profiling.

## Reviewer instructions

1. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extension folder.
2. Open a few ordinary web pages, open Still, and click **Organise tabs**. The action creates conservative local groups and does not require an account or AI connection.
3. Open **Settings** from the popup to review Protection, Routines, AI, and Data & privacy.
4. To test focus protection, add a site under **Protection**, start a short focus session, and open that site in another tab.
5. AI is optional. No credentials are required for review. If testing a connected provider, the reviewer must supply their own endpoint and key.

## Distribution recommendation

Start with **Unlisted** distribution for review and a small pilot. Switch to **Public** after the listing, privacy link, permissions, and store assets have been reviewed.

## Asset checklist

- `assets/icon-128.png` — ready (128 × 128).
- `assets/intervention-render-1440.png` — suitable screenshot (1440 × 900).
- `assets/promo-tile-440x280.png` — ready (440 × 280).
- Add at least one 1280 × 800 or 640 × 400 screenshot if the dashboard rejects the current render.
- `assets/popup-render.png` is 400 × 600 and is not a promotional tile; use it only as an optional product image.
