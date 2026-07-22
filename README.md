# Ruined — After the Fear

Ruined is an immersive studio, project archive, and headless storefront built
with Next.js App Router. Its homepage is a scroll-controlled walk through four
pre-rendered rooms; each destination also has a calmer standalone page for
browsing.

## Running the code

Install dependencies and start the local site:

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
npm start
```

## Routes

- `/` — production homepage and scroll-scrubbed room journey.
- `/store` — full artifact catalogue with optional Shopify checkout.
- `/work` — project archive.
- `/about` — studio profile.
- `/dive` — experimental real-time WebGL room engine; retained for development.

The homepage is the canonical immersive experience. The experimental WebGL
route is intentionally isolated so it can evolve without destabilizing it.

## Architecture

- `app/` — routes, page metadata, and the Shopify revalidation endpoint.
- `src/components/ImmersiveParallax.tsx` — homepage journey and room overlays.
- `src/components/sequence/RoomSequenceCanvas.tsx` — bounded frame decoder and canvas renderer.
- `src/components/store/` — editorial product gallery and checkout controls.
- `src/data/` — local catalogue, projects, and room definitions.
- `src/lib/shopify.ts` — server-only Storefront API integration with local fallback.
- `public/sequences/` — generated room frames and their manifest.
- `scripts/` — scene, brand, and sequence asset tooling.

## Room sequences

Room sources are defined in `src/data/sequences.ts`. After changing frames in
`public/sequences/<room>/`, rebuild the manifest:

```bash
npm run sequences
```

The manifest builder accepts only a complete, contiguous set of 192
`frame-####.webp` files per room. It also generates a content version that is
appended to frame URLs, so a replaced sequence can never reuse stale browser or
CDN bytes. The browser decodes frames on demand and keeps a bounded cache,
rather than holding the complete journey in memory.

## Shopify

Copy `.env.example` to `.env.local` and provide Storefront API credentials.
Without them, both the homepage and store use the repository-owned fallback
catalogue. Shopify product changes can trigger `POST /api/revalidate`. The
handler verifies Shopify's `X-Shopify-Hmac-Sha256` signature using
`SHOPIFY_WEBHOOK_SECRET` and deduplicates recent webhook IDs.

## Asset and font policy

Fallback imagery is stored under `public/`; the default experience has no
placeholder-image network dependency. Typography uses system stacks so builds
are network-independent. Add licensed brand fonts locally in
`src/styles/fonts.css` when final font files are available.

TIFF render masters must stay outside `public/`. Put local masters in the
gitignored `sequence-masters/<room>/` tree, convert them with
`scripts/convert-sequence.mjs --source=...`, and deploy only the resulting WebP
frames. The converter keeps source masters unless `--delete-source` is supplied
explicitly.

## Production checks

Run the full local gate before deploying:

```bash
npm run check
```

This runs ESLint, TypeScript, sequence/asset regression tests, and a production
Next.js build. Configure `NEXT_PUBLIC_ANALYTICS_ENDPOINT` to receive Web Vitals.
