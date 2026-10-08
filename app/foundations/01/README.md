# Foundations 01 call

A standalone presenter deck at `/foundations/01`, with a companion worksheet at
`/foundations/01/timeline`. The existing `/foundations` redirect and member
progression remain unchanged.

The supplied `Ruined_Foundations_01_Cade_Build_Brief.pdf` is the content source.
This call focuses on noticing events and the meaning attached to them. It holds
reframing, usefulness/cost questions, and replacement beliefs for Foundations 02.
Ty's final story, speaker assignments, and section timing remain open.

## Content and design

- `src/components/foundations-call/deck-content.ts` contains the 22 moments and
  speaking notes. The audience content is deliberately brief; the full teaching
  detail is in Presenter.
- `SlideContent.tsx` renders the paired story views, frameworks, examples, and
  Timeline. Existing Ruined marks, IvyOra/Inter type, arrival images, and Walk
  transition videos are reused from the opportunity deck.
- `FoundationsCallDeck.tsx` provides index navigation, full screen, blackout,
  still rooms, touch navigation, and keyboard shortcuts.
- The separate presenter window synchronizes through BroadcastChannel on the
  same browser/device. It is not a remote control for other devices.
- Arrow keys/Space advance, O opens the index, N opens Presenter, F toggles full
  screen, and B blanks the audience screen. Share only the audience window.

## Timeline worksheet

Writing stays in the open tab. Download copy exports a local JSON file; Load
saved copy restores it. There is no automatic browser storage or server save.
The Print / Save PDF button uses the browser print dialog and separate static
print text so multiline writing is not constrained by textarea height.

The version 1 file shape is:

```json
{
  "schemaVersion": 1,
  "experiences": [
    { "when": "", "event": "", "meaning": "" }
  ]
}
```

Imports validate the schema, string types, field sizes, entry count, and file
size before replacing anything. The worksheet uses the brief's two questions,
category hints, and four meaning prompts. It does not mark member progress or
submit personal writing.
