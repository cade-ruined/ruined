# Ruined Foundations

`/foundations` is a 22-moment, full-screen presentation built for a live call.
It uses native scroll/swipe snapping, presenter controls, chapter navigation,
keyboard shortcuts, editable in-memory reflections, and reduced-motion
alternatives. Reflection writing is never persisted or transmitted.

## Editing content

All presentation copy and structure lives in:

- `src/data/foundations.ts`

Edit the four entries in `FOUNDATION_SESSIONS` to replace founder copy,
teaching statements, reflections, DNA cards, Path descriptions, artifacts, and
the future-self letter prompts. `FOUNDATION_MOMENTS` controls the ordered
22-moment presentation sequence.

## Replacing placeholder visuals

Founder artifact compositions live in:

- `src/components/foundations/FounderArtifact.tsx`
- `src/components/foundations/artifact.module.css`

Each composition is locally generated with CSS so it can later be replaced by
real scans or photography without changing the presentation shell. Replace the
artboard content with a local `next/image` asset while preserving its accessible
label and aspect ratio.

## Colors and timing

Route-scoped palette variables and presentation layout live at the top of:

- `src/components/foundations/foundations.module.css`

The global palette begins with `--black`, `--faded-black`, `--bone`, `--paper`,
`--tan`, `--muted-blue`, `--white`, and `--danger`. Shared reveal timing is set
by `revealTransition` near the top of
`src/components/foundations/PresentationShell.tsx`. The opening slash delay is
controlled in the entry moment’s Motion transition.

## Controls

- `ArrowRight`: next moment
- `ArrowLeft`: previous moment
- `Space`: enter or advance
- `Escape`: open the chapter overview
- Scroll or swipe: native moment navigation

Shortcuts pause while focus is inside form controls. Presenter controls appear
at the bottom-right on hover, focus, or touch and include previous, next,
chapter overview, grain, sound label, restart, and fullscreen.

## Reusable components

- `PresentationShell` — navigation, state, and the ordered moment renderer
- `ChapterOverview` — accessible chapter dialog and chapter jumps
- `ProgressPath` — four-chapter progress rail
- `PresenterControls` — live-call control dock
- `FounderArtifact` — replaceable founder artifact compositions
- `ReflectionPrompt` — editable in-memory reflection surface
- `PhilosophyNoise` — noise-to-CHOICE signature transition
- `WordSequence` — ordered philosophy word treatment
- `RuinedMarkBuilder` — four-piece assembling mark
- `FilmGrain`, `SlashTransition`, and `CursorParallax` — shared motion language
