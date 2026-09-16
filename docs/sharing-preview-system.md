# Ruined sharing previews

Revision: September 16, 2026. Deployment verification is recorded separately in the release notes.

## Approved artwork

Use the same original white collage with the pink cassette tape for every public sharing preview, including product links. The user explicitly replaced the room-image direction with this single-image treatment.

- Source: `public/sharing/ruined-cassette-v1.jpg`.
- Original recovered unchanged from Git blob `fcbd1acae33c4ea4f9f8be894b7cf517998c2468` (the former root sharing image).
- SHA-256: `63db0a24423200760a5b683d98850d19e5d43e0eb5253230b4745c1817ef4ad2`.
- JPEG, 1200 × 630, 253,565 bytes.
- No crop, added logo, caption strip, typography overlay, filters or re-encoding.

The artwork already contains the Ruined identity. Do not recreate or replace it with generated imagery.

## One source of truth

`src/lib/sharing-previews.json` declares the source, alt text and dimensions. `src/lib/sharing.ts` supplies that image to both Open Graph and Twitter. Its route-facing helper accepts only title, description and path: individual pages cannot silently override the approved image.

Public titles, descriptions and URLs remain page-specific. Store social copy uses **apparel**, not garments. Product color URLs and actual product-page photography remain intact; only the social card uses the cassette.

`npm run assets:sharing` validates the original JPEG and copies it byte-for-byte to the compatibility URLs:

- `/opengraph-image.jpg` and `/twitter-image.jpg`.
- The six earlier `/sharing/*-v2.jpg` paths.

`npm run assets:brand` delegates to the same copy routine. No old room card remains at a served compatibility URL.

**Keep sharing images in `public/`, not Next's automatic `app/` image conventions.** Actual route checks found that the old automatic root image files overrode route metadata and reintroduced cards on private pages. The obsolete Store/About/Work image generators remain removed.

## Route behavior

- Home, Store, products, About, Community, event registration, Contact, legal information, member sign-in and dormant Artifacts all use the same cassette artwork.
- Private member/operator pages, Bag, confirmation pages, internal Foundations and Dive retain the explicit social/canonical reset and existing noindex rules. Authentication and private records are unchanged.
- `/members` still redirects to `/#members`; hash links inherit homepage metadata. With one image everywhere, this no longer creates an image mismatch. Different page-specific titles would still require a separate public page.
- The dormant LP remains dormant; if re-enabled, it also uses the cassette.

## Checks and release

The sharing tests enforce the original image's exact hash, matching channels, no per-route overrides, private metadata clearing and product color URL behavior. They also verify all compatibility images are byte-identical.

Before release, deploy the public website assets with its metadata, then the member-site metadata that references those public assets. Check fresh pasted links afterward. Previously shared messages may retain a cached preview; replacing server files cannot edit existing messages.

This revision changes sharing metadata and its assets only. Shopify content, customer data, permissions, authentication flows and source photography remain unchanged.
