# Project artwork — `/work`

Drop project photography here. Each project has its own folder named by its
**slug** (wired in `src/data/projects.ts`).

```
public/work/<slug>/
  cover.jpg     ← sleeve face (the record cover on the shelf + detail thumbnail)
  1.jpg         ← detail carousel, image 1
  2.jpg         ← detail carousel, image 2
  3.jpg         ← detail carousel, image 3
```

## Slugs

| Nº | Project           | Folder                      |
|----|-------------------|-----------------------------|
| 08 | Ash & Oak         | `ash-oak/`                  |
| 07 | Tarpaulin Nº 3    | `tarpaulin-no-3/`           |
| 06 | Concrete Hours    | `concrete-hours/`           |
| 05 | Salt Print Series | `salt-print-series/`        |
| 04 | Objet Trouvé      | `objet-trouve/`             |
| 03 | Warehouse 17      | `warehouse-17/`             |
| 02 | Loom Nº 7         | `loom-no-7/`                |
| 01 | RU / Pilot        | `ru-pilot/`                 |

## Graceful fallbacks

Nothing breaks before the files exist:

- **`cover.jpg` missing** → the record shows its drawn motif + catalog numeral.
- **`1.jpg`/`2.jpg`/`3.jpg` missing** → the carousel shows grayscale placeholders.

So you can add photos one project (or one image) at a time.

## Tips

- **`cover.jpg`** is shown square — use a roughly 1:1 crop.
- Carousel images display at **4:3** (`object-cover`) — landscape works best.
- Want more or fewer carousel images? Edit the project's `images` array in
  `src/data/projects.ts` (the `gallery()` helper defaults to `1.jpg`–`3.jpg`).
- For consistency with the site's register, mildly desaturated / warm-toned
  photography reads best, but full-color covers are fine.
