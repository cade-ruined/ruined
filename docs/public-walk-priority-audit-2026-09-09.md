# Ruined public walk — priority audit

Date: 9 September 2026

## Decision

Keep the existing imagery. Improve reliable access to the experience and its destinations before investing in new sequences. This audit did not change application code, deploy, send inquiries, or submit a purchase.

## Scope and evidence

- Inspected the current working tree, including the unfinished public Members redesign. Local changes are not assumed to be deployed.
- Inspected the local Lobby and Store room at 1440 × 900, including the menu and native scrolling.
- Confirmed the live public catalog and BYOB Tank detail page render a $48 product with fit/size controls and preorder/shipping information.
- Two targeted test groups passed: 36 playback/asset checks and 46 navigation/conversion checks. These groups overlap and primarily test source contracts; they are not 82 distinct end-to-end tests.
- Full responsive testing did not complete. Local page navigation stalled; a direct local `/members` request received no response within eight seconds. Browser-control timeouts then prevented reliable completion of the 390 × 844 and 1024 × 820 checks. Do not treat these development/tool failures as proof of a production navigation defect.
- No production speed benchmark, slow-network simulation, completed checkout, submitted membership inquiry, or measured memory profile was performed.

## 1. Reliable loading and recovery — first implementation priority

### Findings

- A desktop frame is permanently excluded after three failed loads for the lifetime of the mounted player. Short outages can therefore leave it unavailable after the connection returns.
- Moving into a room with no decoded frame from that room deliberately paints black. This avoids showing the wrong room, but needs a better waiting state.
- The desktop loader retries a failed module/manifest indefinitely while CSS hides the readable fallback. The bootstrap is not a complete alternative way to navigate the site.

### Proposed change

Use the existing destination-room still while waiting; reset failed requests after a cooldown or reconnection; offer the readable experience after bounded bootstrap failure. Preserve the current room imagery and shared transition endpoints.

### Acceptance checks

Open a room directly with an empty cache. Interrupt then restore connectivity. Confirm the correct room remains visible and usable, recovery does not require a refresh, and Store/Members destinations remain reachable if animation cannot load.

Evidence: `src/components/sequence/RoomSequenceCanvas.tsx:75–107, 140–155, 243–282`; `src/components/ImmersiveParallax.tsx:138–156, 199–202, 254–269`.

## 2. Direct paths for visitors who already know their destination

### Finding

The primary menu points Store, About, Members, and Community to rooms in the homepage walk, including from standalone pages. The full destination pages exist but require another step. This is intentional current routing, not a broken-link claim.

### Proposed change

Keep the walk as the discovery experience. Let primary destination choices open the full pages, especially when visitors are already on a product or detail page. Keep the logo/Return to the walk route for exploration. Provide a clear Member sign-in entry alongside public membership information; avoid competing navigation systems.

### Acceptance checks

A visitor can reach the catalog and membership information directly; back navigation preserves a sensible context; the walk and its five-room vocabulary still work with touch, keyboard, and a mouse.

Evidence: `src/data/navigation.ts:1–8, 102–109`; `src/components/SiteHeader.tsx:180–201, 300–329`.

## 3. Honest shopping states

### Findings

- Missing configuration, an unavailable Shopify response, and a genuinely empty catalog all become `[]`. The catalog can then say it is closed when the actual problem is retrieval.
- If the featured tank is absent, the Lobby keeps its image and `$32 · Preorder · Ships September` copy but removes the product link.
- The live catalog currently shows $48. When a real product is available, the Lobby already uses its actual price. The local $32 observation is an outdated fallback, not a confirmed live price mismatch.

### Proposed change

Distinguish unavailable, empty, and available catalog states. Retain safe last-known catalog data if appropriate, while validating current availability before purchase. Never display actionable price/preorder language on an unclickable fallback promotion.

### Acceptance checks

Simulate an unavailable catalog and a removed featured product. Neither should suggest an intentional closure or advertise an obsolete price. Then verify product options, bag behavior, and checkout handoff in an isolated test session without altering an existing customer's bag.

Evidence: `src/lib/shopify.ts:261–274`; `src/components/store/StoreGallery.tsx:6–28`; `src/components/sequence/JourneyIndexes.tsx:149–177, 431–449`.

## 4. A membership-specific inquiry handoff

### Finding

The local Members page explains Foundations, Circles, Academy, and Experiences and correctly separates invitation-only interest from existing-member sign-in. However, Ask about membership opens the generic contact form without carrying the membership topic forward.

### Proposed change

Reuse the existing contact form with the membership topic already selected, one relevant question, and a clear confirmation describing the next step. Set response-time expectations only after the team approves them. Keep invitation-only access; do not invent a price or open self-service checkout as part of this polish.

Approved real member photography, a concrete example of a Circle gathering, and a short account of the first month would strengthen the offer later. Existing placeholders were intentional; replacing them is content work, not a defect fix.

### Acceptance checks

Follow Explore membership → Ask about membership. The form preserves intent, handles errors, and confirms the next step. Verify actual delivery only with an authorized test submission.

Evidence: `src/data/public-membership.ts:47–50`; `src/components/public-members/MembersPage.tsx:14–18, 125–134`; `src/components/ContactForm.tsx:66–115`.

## 5. Tune performance against measurements

- The complete desktop sequence is 809 frames, approximately 87.7 MiB compressed. It is requested on demand, not entirely upfront.
- Mobile uses 44 intermediate images totaling approximately 1.5 MiB, plus shared arrival images and video. That is not the entire mobile page weight.
- The desktop cache permits 48 decoded 1080p frames: approximately 380 MiB of raw pixel storage before other browser overhead. This is a calculated upper-bound working-set risk, not an observed crash or measured allocation.
- The desktop render loop still wakes when the scroll target is unchanged. Device selection considers pointer, viewport and reduced motion, but not data-saver preference or a user-selected lighter experience.

First measure cold/warm loading, frame responsiveness, idle work and memory in an isolated production build. Then tune a pixel-budgeted cache, suspend unnecessary idle work, and consider a quiet lighter-experience option. Do not shrink buffers blindly or increase image resolution before measurement.

Evidence: `src/data/sequence-config.json`; `src/data/mobile-sequence-config.json`; `src/components/sequence/RoomSequenceCanvas.tsx:33–51, 252–282`; `src/utils/immersiveExperience.ts:9–29`.

## Preserve

The art direction; continuous desktop scrolling; the lighter mobile architecture; shared arrival frames; reduced-motion support; direction-aware loading; limited concurrent requests; versioned caching; hidden-panel keyboard protection; menu Escape/focus handling; and the distinction between public membership information and private accounts.

## Next bounded pass

1. Establish a stable isolated preview so failures can be reproduced without disturbing concurrent work.
2. Implement loading recovery and honest catalog fallback states.
3. Simplify destination routing and the membership inquiry handoff.
4. Verify at 390 × 844, 1024 × 820 and 1440 × 900, including cold loading, interrupted connectivity, reverse scrolling, keyboard navigation and return paths.
5. Show the result before any deployment. No image regeneration is needed for this pass.

## Implementation follow-through — local, not deployed

Completed on 9 September 2026 after approval to continue:

- Replaced permanently excluded frames with capped retry cooldowns, reconnect/manual recovery, request/decode deadlines, and safe cleanup of late bitmaps. A canonical room still covers missing frames; prolonged waits expose Retry, Store, and Members.
- Bounded desktop bootstrap to three attempts. Persistent failure reveals the existing readable journey with retry and direct destinations, instead of hiding it indefinitely.
- Main menu, footer, and public page search now open the full destination pages. In-walk room links still explore the walk. Public links escape the membership host, private account links stay local, and same-page/modified clicks restore overlay focus.
- Added distinct ready, empty, unavailable, and unconfigured catalog states. Missing products no longer leave an obsolete tank promotion. Homepage-only successful reads revalidate after 60 seconds; failures are not cached as success, and promotions older than two minutes are hidden during an extended outage. Store/product/purchase reads are not put in that cache.
- Membership inquiries open the existing form with Membership selected, a relevant prompt, invitation-only context, and an email-follow-up confirmation. The validated topic reaches the email subject/body. Ordinary contact remains available.

### Verification

- Full automated suite: **834 tests passed**. Includes real Next cache behavior and failure recovery, canvas runtime recovery/deadline tests, navigation behavior, and mocked contact-provider delivery. These are not 834 browser end-to-end tests.
- Full lint, TypeScript, and whitespace checks passed.
- An isolated production build passed. It uses preview settings and no copied provider credentials; the local Store intentionally exercises the unavailable/unconfigured state, not the live Shopify catalog.
- Browser checks at **390 × 844, 1024 × 820, and 1440 × 900**: Members page/room, inquiry sheet, direct inquiry route, topic switching, reachable mobile submit button, menu routing, Escape, same-page menu focus restoration, and overflow checks. The tested pages reported no browser warnings/errors.
- Desktop uses its existing animated mode; a 24-pixel wheel input settled at 24 pixels without snapping. Phone/tablet use the mobile stage; forward travel to Community starts its video, and reverse travel returns to Members without page scrolling.
- Current isolated preview: `http://127.0.0.1:3002/members`. A stale, unresponsive original preview process was stopped. Source images and unrelated operator changes were preserved.

### Still separate from this pass

No deployment, real inquiry email, checkout submission, live account mutation, production network benchmark, memory profile, or browser-level offline simulation was performed. Failure paths were exercised through controlled automated tests. Further cache sizing or idle-render tuning should follow actual performance measurements. Real member photography and approved offer details remain content work.
