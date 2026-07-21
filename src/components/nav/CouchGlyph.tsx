import svgPaths from "@/imports/Group5-1/svg-g7cg4dpwhg";

// The original couch artwork draws its four navigation icons as one flat set of
// paths. This helper extracts a single glyph by index so the persistent header
// preserves the established Ruined icon language without retaining the couch.

const FRAME_W = 414.716;
const QUARTER = FRAME_W / 4; // each icon owns one horizontal quarter

type Box = { x: number; y: number; w: number; h: number };

// Tight bounding box for a set of ABSOLUTE svg paths (commands used here:
// M, L, C, Z, H, V). Tracks every on-curve point plus cubic control points so
// each extracted glyph can be centered and sized consistently in the rail.
function bboxOf(paths: string[]): Box {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const hit = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  const token = /([MLCZHV])|(-?\d*\.?\d+)/g;
  for (const d of paths) {
    let cmd = "";
    let nums: number[] = [];
    let cx = 0;
    let cy = 0;
    const flush = () => {
      if (cmd === "H") {
        for (const n of nums) hit((cx = n), cy);
      } else if (cmd === "V") {
        for (const n of nums) hit(cx, (cy = n));
      } else if (cmd === "M" || cmd === "L") {
        for (let i = 0; i + 1 < nums.length; i += 2) hit((cx = nums[i]), (cy = nums[i + 1]));
      } else if (cmd === "C") {
        for (let i = 0; i + 5 < nums.length; i += 6) {
          hit(nums[i], nums[i + 1]);
          hit(nums[i + 2], nums[i + 3]);
          hit((cx = nums[i + 4]), (cy = nums[i + 5]));
        }
      }
      nums = [];
    };
    let m: RegExpExecArray | null;
    token.lastIndex = 0;
    while ((m = token.exec(d))) {
      if (m[1]) {
        flush();
        cmd = m[1];
      } else {
        nums.push(parseFloat(m[2]));
      }
    }
    flush();
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: QUARTER, h: QUARTER };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Assign every path to an icon by the x of its first moveto (the four icons are
// spatially clustered in their quarters), then precompute each glyph's tight
// box once at module load.
const GROUPS: string[][] = [[], [], [], []];
for (const d of Object.values(svgPaths) as string[]) {
  const m = d.match(/M\s*(-?[\d.]+)/);
  const x = m ? parseFloat(m[1]) : 0;
  const idx = Math.min(3, Math.max(0, Math.floor(x / QUARTER)));
  GROUPS[idx].push(d);
}
const BOXES: Box[] = GROUPS.map(bboxOf);

export function CouchGlyph({
  index,
  className,
}: {
  /** 0 = Home, 1 = Store, 2 = Work, 3 = About (couch order). */
  index: number;
  className?: string;
}) {
  const paths = GROUPS[index] ?? [];
  const b = BOXES[index] ?? { x: 0, y: 0, w: QUARTER, h: QUARTER };
  const pad = Math.max(b.w, b.h) * 0.08;
  const viewBox = `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`;
  return (
    <svg
      viewBox={viewBox}
      fill="none"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden
    >
      {paths.map((d, i) => (
        // currentColor lets the parent drive (and CSS-transition) the fill.
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}
