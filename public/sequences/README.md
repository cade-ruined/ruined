# Approved room frame sequences

Only the canonical web-ready sequences, their manifest, and the optimized
fireside loop belong here:

```
public/sequences/
  lobby/
  store/
  records/
  lounge/
  fireside/fire-stream-loop-mobile.mp4
  manifest.json
```

Each room must contain the number of frames approved in
`src/data/sequence-config.json`, named contiguously from `frame-0001.webp`.
The manifest builder rejects missing numbers, extra images, other image
formats, and noncanonical names. Keep TIFF, PNG, BMP, and JPEG render masters
outside all of `public/`, such as in the gitignored
`sequence-masters/<room>/` directory or external archival storage.

## Replace a room sequence

Give the converter a directory containing the configured number of raw frames
for that room. Source names may vary; they are naturally sorted before
conversion.

```bash
node scripts/convert-sequence.mjs lobby 1600 900 80 \
  --source=sequence-masters/lobby
```

The converter writes the WebPs into a clean staging directory and then replaces
the room directory in one swap. That prevents higher-numbered frames from an
older render surviving at the end of a new sequence. Source masters are kept by
default; pass `--delete-source` only when you intentionally want them removed
after a successful replacement.

Then validate the canonical sets and regenerate their content version:

```bash
npm run sequences
```

This command verifies all four rooms, writes `public/sequences/manifest.json`,
and updates the cache version used by every frame URL. It also runs
automatically before the development server and production build.
