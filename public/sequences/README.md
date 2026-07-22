# Approved room frame sequences

Only the four canonical, web-ready sequences belong here:

```
public/sequences/
  lobby/
  store/
  records/
  lounge/
```

Each room must contain exactly 192 files named `frame-0001.webp` through
`frame-0192.webp`. The manifest builder rejects missing numbers, extra images,
other image formats, and noncanonical names. Keep TIFF, PNG, BMP, and JPEG
render masters outside `public/`, such as in the gitignored
`sequence-masters/<room>/` directory or external archival storage.

## Replace a room sequence

Give the converter a directory containing exactly 192 raw frames. Source names
may vary; they are naturally sorted before conversion.

```bash
node scripts/convert-sequence.mjs lobby 1600 900 80 \
  --source=sequence-masters/lobby
```

The converter writes all 192 WebPs into a clean staging directory and then
replaces the room directory in one swap. That prevents higher-numbered frames
from an older render surviving at the end of a new sequence. Source masters are
kept by default; pass `--delete-source` only when you intentionally want them
removed after a successful replacement.

Then validate the canonical sets and regenerate their content version:

```bash
npm run sequences
```

This command verifies all four rooms, writes `public/sequences/manifest.json`,
and updates the cache version used by every frame URL. It also runs
automatically before the development server and production build.
