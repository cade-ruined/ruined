# Foundations 01 call

A standalone 34-slide presenter deck at `/foundations/01`, with the connected
member Timeline available through `/foundations/01/timeline`. The existing
`/foundations` redirect and member progression remain unchanged.

The current audience flow follows the supplied
`Ruined_Foundations_01_Master_Review_Deck_REBUILT.pptx`. The earlier
`Ruined_Foundations_01_Cade_Build_Brief.pdf` is historical context. As requested,
slide 2 omits “why people matter.” The rebuilt flow includes noticing how meaning
shaped someone and optional present-day perspective without forcing a reframe.
Ty's final personal story, speaker assignments, and section timing remain open.

## Content and design

- `src/components/foundations-call/deck-content.ts` contains the 34 slides,
  five chapters, audience copy, themes, and presenter notes. The supplied PPTX's
  notes contain serialization errors, so the concise web presenter notes are
  derived from its visible slide content; they are not recovered narration.
- `SlideContent.tsx` renders the reactive cards, word fields, event/story divider,
  examples, Timeline, perspective controls, and ten-minute exercise timer.
- `foundations-call.module.css` defines the slide compositions;
  `graphic-shell.module.css` defines the theme surfaces and presentation controls.
  These restore the original Foundations graphic language: black, bone, paper,
  tan, muted blue, square cards, the supplied Ruined wordmark, and IvyOra/Inter.
- The existing `FilmGrain`, `CursorParallax`, and `SlashTransition` components
  are reused from `src/components/foundations`. Reveals use the original
  0.66-second easing. Device reduced-motion preferences and the help dialog's
  Pause animations control disable motion. Walk room imagery and travel videos
  are not part of this deck.
- `FoundationsCallDeck.tsx` retains slide hashes, the index, full screen, blackout,
  touch navigation, keyboard shortcuts, and a separate presenter window.

## Presenting and interaction

Share only the audience window. Presenter shows the current title, speaking
notes, controls, and next slide. It synchronizes through BroadcastChannel in the
same browser/device; it is not a remote control for other devices.

Arrow keys, Page Up/Page Down, and Space navigate. Home/End jump to the first or
last slide. O opens the index, N opens Presenter, F toggles full screen, B blanks
the audience screen, and ? opens help. Swipe sideways or use the footer arrows
on touchscreens. Form controls and interactive slide buttons keep their own
keyboard and touch behavior.

Click the framework, culture, example, and influence cards to emphasize an item.
The event/story divider supports dragging and native range-keyboard controls.
Then/Now changes the perspective examples. The ten-minute exercise timer has
Start, Pause/Resume, and Reset controls; leaving that slide resets its local state.
These interactions do not write member data.

## Connected Timeline

`/foundations/01/timeline` continues to hand off to the authenticated membership
route `/my/foundations/timeline/part-1`. It uses the existing canonical private
Timeline entries and stores a separate meaning on each original event. Signing
in returns to Part I. The member app retains its existing launch and access gates.
The deck's new prompts do not add or change member database fields.

Production uses `https://members.theruinedproject.com`. For a local review, set
`NEXT_PUBLIC_MEMBERSHIP_SITE_URL=http://127.0.0.1:3130` when building/running this
public deck and run the member application on that port. The member dev preview
uses example moments and keeps edits only in its open tab.

The connected membership route and its database migration were released with
the previous deck. This revision changes the public call experience only;
account saves and conflict protection remain in the member app.
