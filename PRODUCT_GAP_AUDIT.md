# Still product gap audit

Research date: July 28, 2026

## Executive verdict

Still already has a credible and differentiated core:

1. interrupt an impulsive visit;
2. reconnect the user with their focus topic;
3. provide either a mindful choice or a strict session;
4. measure only active-browser use;
5. turn repeated distraction patterns into suggested routines.

That is more coherent than a generic timer-plus-blocklist. Still is currently
strongest as a calm, local-first focus companion for Chrome. It is not yet the
most configurable browser limiter, the hardest blocker, or a cross-device
focus system.

The most important gaps are:

1. daily and rolling usage allowances;
2. reusable focus profiles and allow-only sessions;
3. content-level protection for feeds, Shorts, Reels, recommendations, and
   comments;
4. a completed-session reflection loop and topic-level progress;
5. lightweight settings/routine sync and encrypted export;
6. first-run onboarding and meaningful empty states.

## Current experience evidence

### 1. Start a focus session — healthy

Evidence: `/private/tmp/still-audit-05-focus-start.png`

The popup is calm and unusually clear. Duration, focus topic, and protected
sites are available without a setup maze. This is already more purposeful than
a plain block-now button.

### 2. Meet a distraction during focus — strong

Evidence: `/private/tmp/still-audit-06-intervention.png`

The intervention remembers the focus topic, shows progress and time remaining,
and provides one dominant recovery action. This is Still's best surface and its
clearest differentiation.

### 3. Configure protection — healthy, but too binary

Evidence: `/private/tmp/still-audit-02-protection.png`

Mindful and strict modes are understandable, and strict exit expectations are
visible. Protection is currently site-on or site-off, however. There is no
daily allowance, rolling allowance, allow-only mode, named list, or category
pack.

### 4. Create routines — strong

Evidence: `/private/tmp/still-audit-03-routines.png`

Recurring routines, ask-first versus automatic starts, and an evidence-backed
suggestion are unusually thoughtful. The missing concept is a reusable focus
profile: users cannot quickly choose “Writing,” “Study,” or “Evening” when
starting an unscheduled session.

### 5. Understand patterns — promising

Evidence: `/private/tmp/still-audit-01-insights.png`

Active-tab measurement, category totals, leading domains, impulse timing, and
routine suggestions provide a useful foundation. Insights are still passive:
there are no topic/project summaries, user goals, weekly reflection, or direct
way to turn a category into protection.

### 6. Review local data — healthy

Evidence: `/private/tmp/still-audit-04-data-privacy.png`

The local-first explanation is clear and specific. Session history is an
archive rather than a learning loop: the user cannot mark an outcome, add a
completion note, group sessions by topic, or compare intended work with
completed work.

## Competitive comparison

| Product | What users repeatedly value | Still today | Gap |
| --- | --- | --- | --- |
| one sec | A tiny pause that breaks autopilot; intentions and repeated interventions | Strong match, with better focus-topic context during an active session | More configurable re-intervention and access duration |
| LeechBlock NG / StayFocusd | Daily or rolling time budgets, remaining-time feedback, flexible schedules, strict “nuclear” blocking | Five-minute intentional passes and schedules | No per-site allowance or rolling budget |
| Freedom / 1Focus / Cold Turkey | Named blocklists, allow-only mode, cross-device protection, hard-to-escape sessions | Strict mode and routines inside Chrome | No allow-only mode, profiles, native apps, or cross-device enforcement |
| Opal | App groups, recurring Deep Focus, temporary breaks, whitelist mode | Comparable routines and focus difficulty | No manual focus profiles or whitelist mode |
| Regain / StayFocusd | Remove only addictive surfaces such as Reels, Shorts, recommendations, and comments | Domain-level protection | No content-level protection |
| Forest | A visible artifact of completed focus, tags, history, and gentle motivation | Calm seed/orb visual and session history | No persistent growth artifact or topic/tag rollup |
| RescueTime | Automatic classification, goals, alerts, projects, and weekly feedback | Active-tab categories and trends | No goals, proactive review, or topic/project outcomes |

## Signals from current products and users

- one sec's core interruption is repeatedly described as effective because the
  small delay makes opening social media a conscious choice. Still already
  gets this right:
  [one sec](https://one-sec.app/),
  [user discussion](https://www.reddit.com/r/productivity/comments/1kvnuzs).
- LeechBlock NG has a 4.9 rating from roughly 1,500 Chrome Web Store ratings and
  supports fixed periods plus limits such as ten minutes per hour. That is a
  strong signal for flexible allowances:
  [Chrome Web Store](https://chromewebstore.google.com/detail/leechblock-ng/blaaajhemilngeeffpbfkdjjoefldkok?hl=en).
- StayFocusd advertises more than two million users and combines daily limits,
  strict blocking, and removal of individual distracting features inside
  social sites:
  [StayFocusd](https://www.stayfocusd.com/).
- Freedom makes reusable blocklists, website exceptions, recurring schedules,
  Locked Mode, and multi-device sessions central to its product:
  [Freedom features](https://freedom.to/features).
- Cold Turkey supports Pomodoro breaks, rolling allowances, rewards after work,
  passwords, delays, and restart-based locks:
  [Cold Turkey features](https://getcoldturkey.com/features/).
- Opal users describe scheduled Deep Focus and short breaks as useful because
  the same social app may be required briefly for legitimate work. Its product
  also highlights whitelist mode:
  [Opal community](https://community.opal.so/t/how-do-you-set-up-your-app-groups-how-do-you-set-your-schedule/440/2),
  [Opal](https://www.opal.so/team/andy-bennett).
- Regain users specifically praise blocking YouTube Shorts and Instagram Reels,
  rather than losing the useful parts of the apps:
  [user discussion](https://www.reddit.com/r/minimalism/comments/1bp0xvw/regain_app_for_android_is_so_good_it_should_be/).
- RescueTime connects automatic tracking to goals, alerts, project/task time,
  and focus sessions:
  [RescueTime](https://www.rescuetime.com/),
  [Focus features](https://www.rescuetime.com/features/focus/solo).

## Priority recommendations

### P0 — protect trust

#### Be precise about “strict”

Still prevents its own five-minute access path and adds cooldown friction, but
a normal browser extension cannot prevent a user from disabling or uninstalling
it. Keep the name **Strict focus**, but describe its boundary once:

> No intentional access or early exit during this session. Browser extensions
> can still be disabled from Chrome.

Truly tamper-resistant protection requires a native companion, enterprise
policy, or operating-system support.

#### Build a first-run success path

The first run should help the user:

1. protect one current distraction;
2. start a ten-minute session with a real topic;
3. experience the intervention once;
4. understand what is stored locally.

Do not begin with the full settings surface or an empty analytics dashboard.

### P1 — highest-value feature gaps

#### 1. Daily and rolling allowances

Add an optional policy per site or profile:

- mindful pause only;
- 15 minutes per day;
- 10 minutes in every hour;
- block completely during focus;
- warn two minutes before the allowance ends.

Still already has the active-tab measurement needed to calculate this
accurately. This is the clearest feature gap versus highly rated browser
extensions.

#### 2. Reusable focus profiles and allow-only mode

Examples:

- **Writing:** allow Docs, research sources, and music; block everything else.
- **Study:** allow the course site and notes; protect social, video, and news.
- **Evening:** protect work email and news.

Routines should reference a profile. The popup should let the user select a
profile before beginning focus. During a strict session, users may add a newly
discovered distraction to the profile but may not remove one.

#### 3. Protect the distracting part

Start with a small, maintainable set:

- YouTube Shorts and recommendations;
- Reddit home/popular feeds while allowing direct posts;
- Instagram Reels and Explore;
- social-media comments where the user chooses.

This is highly aligned with Still: let users complete an intentional task
without opening the infinite-scroll trap.

#### 4. Close the focus loop

At session end, show:

- **Finished**
- **Continue for 10 minutes**
- **Take a break**
- optional one-line outcome: “What moved forward?”

Use the focus topic and outcome to create a quiet weekly section:

> Product brief · 3 sessions · 1h 35m · completed twice

This borrows the value of Forest tags, Freedom annotations, and RescueTime
projects without adding a complex productivity score.

#### 5. Lightweight sync and portability

Use browser-native sync only for protected sites, profiles, routines, and
preferences. Keep raw browsing history local. Add encrypted export/import for
moving settings between Chrome and Brave. Cross-browser automatic insight sync
can wait until Still has an end-to-end encrypted relay design.

#### 6. Category starter packs

Offer optional packs such as Social, Video, News, Shopping, and Adult. Show the
actual domains before enabling a pack. Category packs reduce setup effort, but
must not silently expand through an opaque remote list.

### P2 — useful after the core gaps

- A weekly focus intention and a gentle “Review your week” notification.
- Keyboard shortcuts and right-click **Protect this site**.
- Configurable five-, ten-, or fifteen-minute intentional access.
- Optional Pomodoro breaks for users who already work that way.
- A non-punitive monthly “garden” of completed sessions.
- CSV/JSON export of aggregated insights.

## Features to avoid for now

- A single productivity score such as 7/10 or 82%. It hides the useful facts and
  creates explanation debt.
- Streak loss, dead trees, coins, leaderboards, or shame-based copy.
- An AI chat coach. On-device categorization and short pattern explanations are
  enough.
- Focus music and soundscapes. They do not strengthen Still's core loop.
- Team, parental-control, or accountability features before the individual
  product is mature.
- Native app and phone blocking disguised as an extension feature.

## Recommended sequence

1. First-run onboarding and strict-mode boundary copy.
2. Allowances with time-left warnings.
3. Named focus profiles plus allow-only mode.
4. Focus completion and topic-level insight.
5. Shorts/feed/recommendation protection for three supported sites.
6. Browser-native settings sync and encrypted export/import.
7. Category starter packs and proactive weekly review.

## Accessibility and evidence limits

- The current screenshots show small secondary labels in Insights, Routines,
  and history. Contrast and readability should be verified at 200% zoom.
- The breathing and progress state uses semantic status text in the captured
  DOM, and the code contains reduced-motion handling; screen-reader timing and
  keyboard-only completion still require hands-on testing.
- The fresh-install empty state and Chrome-extension disable/uninstall path were
  not visually captured in this audit. Recommendations for those areas are
  based on the implemented structure and browser-extension constraints rather
  than screenshot evidence.
- Competitor claims are based on current official feature pages, marketplace
  ratings, and representative user discussions; they are directional product
  signals, not a controlled user study.

## Product position

Still should not try to beat every competitor at its specialty.

- Cold Turkey will remain stricter at the operating-system level.
- RescueTime will remain deeper at analytics.
- Forest will remain more gamified.
- Freedom will remain broader across devices.

Still can own:

> The calm, private focus companion that notices an impulse, reminds you what
> matters, and gradually turns your real distraction patterns into protection
> that fits your life.
