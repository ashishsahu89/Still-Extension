# Still Privacy Policy

**Effective date: August 28, 2026**

Still — Focus on purpose is a Chrome extension for intentional browsing, focus sessions, insights, routines, and tab organization. This policy describes what Still stores, what it sends, and the controls available to you.

## The short version

- Still has no account, analytics service, advertising, or Still-operated server.
- Focus settings, sessions, routines, intentions, tab-organization state, and browsing measurements are stored locally in Chrome extension storage on the device where Still is installed.
- Still measures only the active tab in the focused browser window. It records domain-level usage and event metadata, not page contents, page paths, or page titles as browsing history.
- Local models, including Chrome's built-in model and models running on your computer, stay on the device.
- A remote model receives data only when you explicitly connect and enable that provider for an AI feature. Still sends the minimum data needed for that feature and sends it directly to the provider.

## Information Still stores locally

Depending on the features you use, Still stores:

- settings such as protected sites, focus preferences, routines, and AI connection configuration;
- focus-session records, recent intentions, protected-site impulses, and bounded intentional-access events;
- active-tab usage totals by domain and category, including time-of-day aggregates;
- learned website categories and tab-group metadata such as group membership, names, and whether a group is managed by Still.

Still does not need an account and does not upload this local data to Still. Daily domain totals are retained for up to 550 days. Bounded domain-only occurrences used for time-of-day patterns are retained for up to 90 days. Recent intentions and focus-session history are managed from **Data & privacy** and can be cleared there.

Still pauses active-tab measurement when the browser is not focused, the computer is idle, or measurement is disabled. It does not build a page-content or full-address browsing history.

## AI connections

AI is optional. Still can use Chrome's browser-provided on-device model, a model running on your computer, or a remote OpenAI-compatible provider that you connect yourself.

For tab organization, a remote provider may receive the open tabs' titles and domains. For category Insights, it may receive aggregated domains, active time, visit counts, and time-of-day totals. Still does not send page contents, page paths, query strings, or full page addresses. It does not send unrelated account data or credentials.

Requests go directly from the extension to the provider you selected. Still does not proxy, receive, or retain those requests, and Still never receives your provider API key. The selected provider's privacy, retention, and billing terms apply to data sent to it. Review that provider's policy before enabling a remote connection.

Connection labels, endpoints, model names, and API keys are stored in Chrome's local extension storage on this device so the connection can survive an extension reload. Still does not encrypt that storage. You can disable or remove a connection from **Settings → AI**; removing it deletes the saved key from Still's local storage.

## Sharing and selling

Still does not sell personal information, show advertising, or share local data with data brokers. The only third-party transfer initiated by Still is a request to a remote AI provider after you explicitly configure and enable that provider, as described above. Chrome and the provider may process data according to their own policies.

## Your controls

You can:

- turn off active-tab measurement;
- disable Chrome's on-device model or any connected remote model;
- remove a remote connection and its locally stored API key;
- reset learned website categories;
- clear focus sessions, site usage, impulse history, and recent intentions from **Data & privacy**;
- uninstall Still, which removes the extension's local storage from Chrome.

## Children's privacy

Still is not directed to children under 13, and Still does not knowingly collect information from children.

## Changes and support

We may update this policy when Still's behavior changes. The effective date above will change with a new version. For questions or support, open an issue in the [Still repository](https://github.com/ashishsahu89/Still-Extension/issues).
