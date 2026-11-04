# Protected Practice deck resources

These are audience-only adaptations of the approved `outputs/ruined-next-chapter/site/dist` review. The review files remain unchanged. `provenance.json` records the input hashes and exact media reuse.

- F1 remains the existing approved 23-slide `/my/foundations/deck` resource. No F1 file is changed here.
- F2 has 24 scenes, F3 has 24, F4 has 22, and TIME has 40.
- `data.js` contains only audience slide HTML/text. F2, F3, F4, and TIME have separate payloads. Original facilitator notes, run-of-show, source transcript, communication drafts, and private review workspaces are omitted.
- Visual mechanisms remain interactive. Presentation timers are omitted from the self-paced member resource. Worksheet fields stay in the member assignment, outside the deck.
- Each document and each JS/CSS request independently checks the existing member access policy, Foundations availability, and authoritative course release before reading files.
- Only allowlisted resources are served. A request cannot use a course's resource path to read a different course, arbitrary files, HTML source, or provenance.
- Responses are `private, no-store`, vary by Cookie, and are marked noindex. No external Sites iframe, global framing-policy change, public curriculum bundle, or public HTML copy is introduced.
- Generic media stays in public paths. Existing approved F1 files are reused only when SHA-256 is identical. New media is limited to the bloom video/poster and tiger image.
- The resource can return to `/my/practice?course=...`; viewing it never sends email, writes an assignment, awards a badge, or changes legacy Foundations progress.
- Resume is tab-local session storage under an opaque member-scoped key, containing only the slide position (and TIME demonstration control), never member answers.

The route tracing entries in `next.config.mjs` include this private directory in the server functions. Tests: `tests/practice-deck-resources.test.mjs`.
