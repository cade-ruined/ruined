export type ArchivePoint = { x: number; y: number };
export type ArchiveLightLayout = {
  width: number; height: number; portrait: boolean;
  pendant: ArchivePoint;
  table: { backY: number; frontY: number; pool: ArchivePoint };
};
export type ArchiveShadow = {
  points: ArchivePoint[]; opacity: number; blur: number;
  clipTop: number; clipBottom: number; width: number; height: number;
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const smooth = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / Math.max(.001, high - low), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The same centered cover crop and source breakpoint as the fixed room picture. */
export function getArchiveLightLayout(viewportWidth: number, viewportHeight: number, portraitSource?: boolean): ArchiveLightLayout {
  const width = Number.isFinite(viewportWidth) ? Math.max(1, viewportWidth) : 1;
  const height = Number.isFinite(viewportHeight) ? Math.max(1, viewportHeight) : 1;
  // Media queries include classic scrollbars; the fixed layer's crop does not.
  const portrait = portraitSource ?? width / height <= 4 / 5;
  const source = portrait
    ? { width: 941, height: 1672, lampX: 235, lampY: 255, backY: 1225, frontY: 1515, poolX: 365, poolY: 1360 }
    : { width: 1672, height: 941, lampX: 606, lampY: 120, backY: 682, frontY: 874, poolX: 640, poolY: 754 };
  const scale = Math.max(width / source.width, height / source.height);
  const left = (width - source.width * scale) / 2, top = (height - source.height * scale) / 2;
  return {
    width, height, portrait,
    pendant: { x: left + source.lampX * scale, y: top + source.lampY * scale },
    table: { backY: top + source.backY * scale, frontY: top + source.frontY * scale, pool: { x: left + source.poolX * scale, y: top + source.poolY * scale } },
  };
}

/** Room fill keeps dust visible; the registered pendant adds a brighter cone. */
export function archiveDustIllumination(x: number, y: number, layout: ArchiveLightLayout): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  const { pendant, table } = layout;
  const reach = Math.max(1, table.pool.y - pendant.y);
  const progress = clamp((y - pendant.y) / reach, 0, 1.25);
  const centerX = pendant.x + (table.pool.x - pendant.x) * Math.min(progress, 1);
  const spread = Math.max(14, layout.width * (layout.portrait ? .055 : .035)) + progress * Math.min(layout.width * .28, reach * .28);
  const cone = Math.exp(-Math.pow((x - centerX) / spread, 2) * 1.7);
  const above = smooth(pendant.y - reach * .055, pendant.y + reach * .075, y);
  const below = 1 - smooth(table.pool.y, table.frontY + reach * .045, y);
  return clamp(.16 + .84 * cone * above * below * (.76 + .24 * (1 - progress)), .16, 1);
}
