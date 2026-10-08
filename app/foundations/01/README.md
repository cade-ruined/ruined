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

## Connected Timeline worksheet

`/foundations/01/timeline` hands off to the authenticated membership route
`/my/foundations/timeline/part-1`. It uses the existing canonical private Timeline
entries and stores a separate meaning on each original event. Signing in returns
to Part I. The member app retains its existing launch and access gates.

Production uses `https://members.theruinedproject.com`. For a local review, set
`NEXT_PUBLIC_MEMBERSHIP_SITE_URL=http://127.0.0.1:3130` when building/running this
public deck and run the member application on that port. The member dev preview
uses example moments and keeps edits only in its open tab.

Release the membership database migration and member route before releasing this
public redirect. The former standalone worksheet is replaced; account saves and
conflict protection now belong to the member app.
