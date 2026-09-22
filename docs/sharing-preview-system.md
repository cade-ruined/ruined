# Ruined sharing previews

Revision: September 22, 2026. Deployment verification is recorded separately in the release notes.

## Approved artwork

Use the original white collage with the pink cassette tape as the default public sharing preview. Product links use the item's own photo, as requested on September 22, 2026. The cassette remains the fallback for products without suitable photography.

- Source: `public/sharing/ruined-cassette-v1.jpg`.
- Original recovered unchanged from Git blob `fcbd1acae33c4ea4f9f8be894b7cf517998c2468` (the former root sharing image).
- SHA-256: `63db0a24423200760a5b683d98850d19e5d43e0eb5253230b4745c1817ef4ad2`.
- JPEG, 1200 × 630, 253,565 bytes.
- No crop, added logo, caption strip, typography overlay, filters or re-encoding.

The artwork already contains the Ruined identity. Do not recreate or replace it with generated imagery.

## One source of truth

`src/lib/sharing-previews.json` declares the default source, alt text and dimensions. `src/lib/sharing.ts` supplies the same title, description and image to both Open Graph and Twitter. Its route-facing helper accepts title, description, path and an optional image. Only the product route supplies a photo override; other public routes keep the cassette.

Public titles, descriptions and URLs remain page-specific. Store social copy uses **apparel**, not garments. Product sharing selects the first photo from the same color-aware image selection used by the product page. A selected color without associated photography falls back to the cassette instead of showing another color. Product photos retain their own dimensions when supplied and never inherit the cassette dimensions.

`npm run assets:sharing` validates the original JPEG and copies it byte-for-byte to the compatibility URLs:

- `/opengraph-image.jpg` and `/twitter-image.jpg`.
- The six earlier `/sharing/*-v2.jpg` paths.

`npm run assets:brand` delegates to the same copy routine. No old room card remains at a served compatibility URL.

**Keep sharing images in `public/`, not Next's automatic `app/` image conventions.** Actual route checks found that the old automatic root image files overrode route metadata and reintroduced cards on private pages. The obsolete Store/About/Work image generators remain removed.

## Route behavior

- Product detail links use their own product or selected-color photo, with the cassette as the no-photo fallback.
- Home, Store, About, Community, event registration, Contact, legal information, member sign-in and dormant Artifacts keep the same cassette artwork.
- Private member/operator pages, Bag, confirmation pages, internal Foundations and Dive retain the explicit social/canonical reset and existing noindex rules. Authentication and private records are unchanged.
- `/members` still redirects to `/#members`; hash links inherit homepage metadata. Different page-specific titles would require a separate public page.
- The dormant LP remains dormant; if re-enabled, it also uses the cassette.

## Checks and release

The sharing tests enforce the original image's exact hash, matching channels, product-only photo overrides, private metadata clearing and product color URL/photo behavior. They also verify all compatibility images are byte-identical.

Before release, deploy the public website assets with its metadata, then the member-site metadata that references those public assets. Check fresh pasted links afterward. Previously shared messages may retain a cached preview; replacing server files cannot edit existing messages.

This revision changes sharing metadata and its assets only. Shopify content, customer data, permissions, authentication flows and source photography remain unchanged.
