# Room frame sequences

Only web-ready sequence files belong here. Keep TIFF/PNG render masters outside
`public/`, ideally in the gitignored `sequence-masters/<room>/` directory or in
external archival storage. Scrolling through a room plays its optimized frames
like a dolly shot.

## Where to put frames

```
public/sequences/
  lobby/     ← ruined-hero-1  (the arrival hall)
  store/     ← ruined-hero-store-4
  records/   ← ruined-hero-records  (the "work" hub)
  lounge/    ← ruined-hero-lounge   (the "about" room)
```

One folder per room (the four folders above already exist). The room order and
labels live in `src/data/sequences.ts` — edit there to add/rename/reorder rooms.

## Naming

Name the frames so they sort in playback order. Zero-padded numbers are safest:

```
lobby/0001.jpg
lobby/0002.jpg
...
```

Any of `.jpg`, `.png`, `.webp`, `.avif` work. Keep every frame in a room the
**same dimensions** (ideally the same aspect ratio across all rooms). The build
step sorts frames naturally, so `frame-1.jpg … frame-120.jpg` also works.

Tip for weight: 1280×720–1600×900, quality ~80. ~120 frames per room ≈ 8–12 MB.

## Convert render masters

```bash
node scripts/convert-sequence.mjs lobby 1600 900 80 --keep \
  --source=sequence-masters/lobby
```

This writes optimized WebPs into `public/sequences/lobby/` without moving or
deleting the masters. Repeat for each room.

## After converting

Run:

```
npm run sequences
```

This scans every room folder and writes `public/sequences/manifest.json`
(frame counts + file lists) that the site reads back. Re-run it whenever you
add, remove, or replace frames.

Never place TIFF masters in `public/`: Next serves everything in that directory
as a deployable asset.
