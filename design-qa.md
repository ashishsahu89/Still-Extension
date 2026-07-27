# Design QA — system dark mode

## Evidence

- Source concept: `/Users/swatikeshri/.codex/generated_images/019f989f-794e-7423-8103-0b3ab6ba2594/call_BODisFGHO9Yb7qsvjA8AIpGD.png`
- Implemented Insights capture: `/private/tmp/still-dark-insights-viewport-final.png`
- Side-by-side comparison: `/private/tmp/still-dark-comparison-final.png`
- Light-regression capture: `/private/tmp/still-light-insights.png`
- Popup dark-state capture: `/private/tmp/still-dark-popup-final.png`
- Focus intervention dark-state capture: `/private/tmp/still-dark-intervention-final.png`
- Viewport: 1769 × 889 px
- Source and implementation capture dimensions: 1769 × 889 px
- State: Insights, week selected, system dark palette

The source and implementation were placed side by side in
`/private/tmp/still-dark-comparison-final.png` and reviewed together at full
viewport. A separate focused-region crop was not needed because this change is
palette-only; the popup and intervention captures cover the smaller controls
and focus-session state directly.

## Required fidelity review

- Typography: existing Still serif/sans pairing preserved.
- Layout and spacing: existing product layout preserved intentionally. The
  generated palette concept changed proportions, but it was not used as a
  replacement layout.
- Color: warm charcoal surface, soft off-white type, low-contrast dividers,
  and sage accents match the selected concept.
- Controls: fields, switches, selected navigation, charts, and primary actions
  all use semantic light/dark tokens.
- Copy and data: existing application copy and realistic preview data remain
  intact.
- Assets: existing Still brand mark and breathing illustration are preserved.

## Comparison history

### Iteration 1

- P1: the initial dark primary action and selected-control fill used the
  decorative sage accent with off-white text, producing only about 2.39:1
  contrast.
- Fix: split decorative sage from interactive fill tokens. Dark controls now
  use `#58705c` with `#f4f6f2`, approximately 4.97:1.
- Verification: the final popup capture confirms the updated button treatment,
  and the same tokens are shared by selected periods, switches, and primary
  buttons.

### Iteration 2

- No P0, P1, or P2 visual mismatches remained.
- The subtle generated-image vignette was not copied because the requested
  feature is a system theme, and the established Still surface is intentionally
  flat and consistent across extension pages.

## Behavior and regression checks

- System behavior uses `prefers-color-scheme`; there is no user-facing theme
  setting.
- A local preview-only query hook is limited to HTTP preview pages for visual
  QA and is ignored by the installed extension flow.
- Day/week/month controls remain interactive; Month and Week state changes were
  verified in the rendered app.
- The original light palette was rendered separately and remains unchanged.
- Automated result: 47 tests passed.
- `git diff --check`: passed.

## Final result

passed
