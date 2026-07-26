# Accessibility certification matrix

## Scope and decision boundary

This matrix covers keyboard operation, focus, programmatic names and states,
dynamic announcements, reflow, contrast, and screen-reader behavior for Base
and Live Audio. Automated checks are necessary but do not replace physical
testing with NVDA, VoiceOver, and TalkBack.

The phase starts from baseline `e8da9e3`. A profile cannot receive `GO` while a
required manual case is missing or while a reproducible WCAG 2.2 A/AA failure
remains open.

## Regression closure: alias input focus

Commit `c14e157` closes `A11Y-FINAL-007`. The intervention dialog now keeps one
focus lifecycle for the complete time it remains open. Incoming live state may
rerender its parent and replace callbacks without returning focus to the
launcher, moving it to the dialog title, or discarding the alias being typed.
The focused accessibility suite exercises this rerender explicitly.

## Automated evidence

Run from the repository root:

```powershell
npm.cmd run test
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run build
```

The focused accessibility suites cover:

- modal naming, focus entry, focus trap, Escape, and focus restoration;
- recording confirmation text and duplicate-submit prevention;
- native button semantics and `aria-expanded`/`aria-controls` disclosures;
- named sliders, checkbox state, microphone toggle state, and participant
  permission toggles;
- collapsed Control content removed from the accessibility tree;
- reconnection, queue, private-inbox, and private-message status announcements;
- rejection countdown kept outside the live region;
- pointer-hidden participant actions exposed through `focus-within`.

## Physical test environment

Use the same production build and presentation session for every run.

| Platform | Required setup |
| --- | --- |
| Windows 11 | Current Chrome or Edge, current NVDA, physical keyboard, browse and focus modes |
| iPhone | Physical iPhone, Safari, current VoiceOver, portrait and landscape |
| Android | Physical Android device, Chrome, current TalkBack, portrait and landscape |

Topology: two ready Controls, two Audience devices, Live Audio enabled, duplicate
aliases, at least three queued participants, and controllable network loss. Run
every required case twice consecutively per platform.

## Required manual cases

| ID | Flow | Pass condition |
| --- | --- | --- |
| A01 | Route entry and landmarks | Page title, headings, regions, and controls are read in visual order; hidden content is skipped. |
| A02 | Zoom and reflow | At 200% and 400%, critical actions remain usable without two-dimensional scrolling. |
| A03 | Participant entry dialog | Named modal, initial focus inside, confined focus, Escape/close, and focus restoration. |
| Q01 | Request/cancel speaking | State is announced once; the same control remains focused and exposes its pressed state. |
| Q02 | Control grants/revokes/mutes/blocks | Audience hears the consequence; no obsolete control retains focus. Blocking is an alert. |
| Q03 | Queue changes | Control receives a concise count announcement without repeated list narration. |
| R01 | Recording active on admission | One explicit icon-and-text notice; microphone-capable users retain a persistent reminder. |
| R02 | Recording starts during participation | Immediate single announcement, active microphone stops, old confirmation is invalid, and focus remains stable. |
| R03 | Recording ends | Reminder disappears without a new confirmation or unexpected focus movement. |
| M01 | Secondary Control authorization | Pending, synchronizing, and ready states are distinguishable and announced in order. |
| M02 | Multi-Control convergence | Alias ordinals, queue, permissions, policies, and ownership match on both Controls. |
| M03 | Control reconnect/succession | Reconnect and role change are announced without duplicate identity or focus loss. |
| P01 | Private message send | Named modal, sending status, success status after close, failure alert, and focus restoration. |
| P02 | Private inbox | Trigger announces only a neutral count; content is read only after opening; close restores trigger focus. |
| L01 | Audio reconnect | Reconnecting/reconnected announce once; failure is an alert with a named retry action. |
| L02 | Remote phase change | If the focused control disappears, focus moves to a related stable heading or status, never to `body`. |
| C01 | Sliders and toggles | Reader announces name, current value/state, range, and result; no precision drag is required. |
| C02 | Reduced motion and contrast | Essential information does not rely only on color; nonessential pulse/spin respects reduced motion. |

## Evidence record

Record one row per execution:

| Field | Value |
| --- | --- |
| Commit and image digest | |
| Date and operator | |
| OS, device, browser | |
| Screen reader and version | |
| Case ID and run 1/run 2 | |
| Result | `PASS` / `FAIL` / `BLOCKED` |
| Evidence path or link | |
| Finding ID when failed | |

## Blocking rules

The affected profile remains `NO-GO` for any keyboard-inoperable critical
control, unnamed dialog/control, lost focus, missing critical announcement,
announcement storm, sensitive content read without opening it, stale recording
state, or mandatory case failing on any platform. Missing physical evidence can
support at most `GO condicionado`; it can never support an unconditional `GO`.
