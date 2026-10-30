# Ruined Foundations

The member Foundations experience is the approved **Foundations 01** interactive
deck (23 slides, published version 29, October 29, 2026).

- `/my/foundations` is the member entry page.
- `/my/foundations/deck` serves the full-page presentation.
- `/my/foundations/experience` redirects old bookmarks to the replacement deck.
- `/foundations` continues to route through the member entry and its access gates.

The previous 22-moment presentation and its practice/completion controls are no
longer offered in the member experience. Existing enrollment and completion
records remain intact. Reading or finishing this deck does not complete all four
Foundations sessions or write to the legacy progress API.

## Access

`MEMBERSHIP_FOUNDATIONS_LAUNCHED=true` opens Foundations to eligible members.
Before launch, only members with current Administrator (`ops_admin`) access can
open it. Profile activation and membership eligibility still apply.

The standalone HTML route runs its own visibility, session, registration, launch,
and membership checks because route handlers do not use the member React layout.
It returns a private, non-cacheable document. No framing permissions are relaxed.

## Approved source

- Original HTML: `src/data/foundations-deck/index.html`
- Original assets: `public/membership/foundations/deck-v29/`
- Source version, publication URL, commit, and file hashes:
  `src/data/foundations-deck/provenance.json`
- Member-only navigation and resume adapters: `member.js` and `member.css` in the
  versioned asset directory.

Keep approved presentation files unchanged when updating the member adapter.
Future deck replacements should import the verified published source and record
its provenance. The standalone HTML is included explicitly in Next's production
function tracing.

## Member controls and privacy

The deck includes its slide index, arrow navigation, motion preference, slide
text, interactive scenes, and fullscreen control. A My Foundations link returns
to the member area. Presenter tools and cross-tab synchronization are disabled.

Only the last slide number is saved, in tab-local session storage scoped to the
member and deck version. Answers are never saved or submitted by this reader.
Member Timeline and Journal remain separate features with their existing privacy
rules.
