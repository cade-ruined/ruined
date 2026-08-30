"use client";

import {
  type KeyboardEvent,
  type RefCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TimelineDraftEntry } from "@/components/membership/timeline-model";

import styles from "./ruined-timeline.module.css";

type RoadAnchor = {
  cardLeft: number;
  cardTop: number;
  cardWidth: number;
  entry: TimelineDraftEntry;
  index: number;
  putRight: boolean;
  roadEdge: number;
  selected: boolean;
  x: number;
  y: number;
};

type RoadLayout = {
  anchors: RoadAnchor[];
  bleedPath: string;
  bodyPath: string;
  cardWidth: number;
  center: number;
  corePath: string;
  height: number;
  mobile: boolean;
  path: string;
  pathPoints: Array<{ x: number; y: number }>;
  roadHalf: number;
  width: number;
};

function roadXAt(y: number, height: number, width: number, mobile: boolean) {
  const progress = Math.max(0, Math.min(1, y / height));
  const stops = mobile
    ? [[0, 0], [0.16, 9], [0.42, -7], [0.7, 8], [1, -4]]
    : [[0, 0.6], [0.17, 0.29], [0.43, 0.72], [0.71, 0.41], [1, 0.67]];
  let start = stops[0]!;
  let end = stops[stops.length - 1]!;

  for (let index = 0; index < stops.length - 1; index += 1) {
    const candidate = stops[index]!;
    const next = stops[index + 1]!;
    if (progress >= candidate[0]! && progress <= next[0]!) {
      start = candidate;
      end = next;
      break;
    }
  }

  const segment =
    (progress - start[0]!) / Math.max(0.001, end[0]! - start[0]!);
  const eased = segment * segment * (3 - 2 * segment);
  const value = start[1]! + (end[1]! - start[1]!) * eased;

  if (mobile) return Math.max(34, Math.min(66, 48 + value));
  return Math.max(48, Math.min(width - 48, width * value));
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index]!;
    const next = points[index + 1]!;
    path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`;
  }
  const last = points[points.length - 1]!;
  return `${path} T ${last.x} ${last.y}`;
}

function smoothClosedPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 3) return "";
  const first = points[0]!;
  const last = points.at(-1)!;
  let path = `M ${(last.x + first.x) / 2} ${(last.y + first.y) / 2}`;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`;
  }
  return `${path} Z`;
}

export function buildInkRibbonPath(
  points: Array<{ x: number; y: number }>,
  halfWidth: number,
  phase = 0,
) {
  if (points.length < 2) return "";
  const left: Array<{ x: number; y: number }> = [];
  const right: Array<{ x: number; y: number }> = [];
  points.forEach((point, index) => {
    const previous = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    const length = Math.max(0.001, Math.hypot(next.x - previous.x, next.y - previous.y));
    const normalX = -(next.y - previous.y) / length;
    const normalY = (next.x - previous.x) / length;
    const pressure =
      0.88 +
      Math.sin(index * 0.43 + phase) * 0.105 +
      Math.sin(index * 0.127 + phase * 0.73) * 0.055;
    const leftEdge = halfWidth * (pressure + Math.sin(index * 0.91 + 1.7 + phase) * 0.035);
    const rightEdge = halfWidth * (pressure + Math.sin(index * 0.79 + 4.1 + phase) * 0.045);
    left.push({ x: point.x + normalX * leftEdge, y: point.y + normalY * leftEdge });
    right.push({ x: point.x - normalX * rightEdge, y: point.y - normalY * rightEdge });
  });
  return smoothClosedPath([...left, ...right.reverse()]);
}

export function buildInkRoadLayout(
  entries: TimelineDraftEntry[],
  activeKey: string | null,
  measuredWidth: number,
  measuredHeights: ReadonlyMap<string, number>,
): RoadLayout {
  const width = Math.max(measuredWidth, 240);
  const mobile = width < 620;
  const center = mobile ? 48 : width / 2;
  const cardWidth = mobile
    ? Math.max(150, width - 112)
    : Math.min(292, width * 0.35);
  const roadHalf = mobile ? 19 : 32;
  const cardGap = mobile ? 14 : 52;
  const topInset = 120;
  const minimumPitch = mobile ? 235 : 215;
  const baseBottomInset = mobile ? 225 : 200;
  const heights = entries.map((entry) => measuredHeights.get(entry.clientKey) ?? 96);

  let height = 620;
  let anchorYs: number[] = [];
  if (entries.length === 1) {
    height = Math.max(620, heights[0]! + 280);
    anchorYs = [height / 2];
  } else if (entries.length > 1) {
    let cursorY = topInset;
    anchorYs = entries.map((_, index) => {
      const y = cursorY;
      if (index < entries.length - 1) {
        cursorY += Math.max(minimumPitch, heights[index]! + 28);
      }
      return y;
    });
    const lastHeight = heights[heights.length - 1]!;
    const bottomInset = Math.max(baseBottomInset, lastHeight - 42 + 30);
    height = Math.max(620, anchorYs[anchorYs.length - 1]! + bottomInset);
  }

  const anchors = entries.map((entry, index) => {
    const y = anchorYs[index] ?? height / 2;
    const x = roadXAt(y, height, width, mobile);
    const putRight = mobile || x < center;
    const roadEdge = putRight ? x + roadHalf : x - roadHalf;
    const cardTop = Math.max(44, y - 42);
    const cardBottom = cardTop + heights[index]!;
    const roadEnvelope: number[] = [];
    for (let sampleY = cardTop - 8; sampleY <= cardBottom + 8; sampleY += 12) {
      roadEnvelope.push(roadXAt(sampleY, height, width, mobile));
    }
    const safeRoadEdge = putRight
      ? Math.max(...roadEnvelope) + roadHalf
      : Math.min(...roadEnvelope) - roadHalf;
    const cardLeft = putRight
      ? Math.min(width - cardWidth - 4, safeRoadEdge + cardGap)
      : Math.max(4, safeRoadEdge - cardWidth - cardGap);
    return {
      cardLeft,
      cardTop,
      cardWidth,
      entry,
      index,
      putRight,
      roadEdge,
      selected: entry.clientKey === activeKey,
      x,
      y,
    };
  });
  const pathPoints: Array<{ x: number; y: number }> = [];
  for (let y = -40; y <= height + 40; y += 24) {
    pathPoints.push({ x: roadXAt(y, height, width, mobile), y });
  }
  const phase = entries.reduce(
    (value, entry) => value + entry.clientKey.charCodeAt(0) + entry.year,
    0,
  ) % 29;

  return {
    anchors,
    bleedPath: buildInkRibbonPath(pathPoints, roadHalf + (mobile ? 3.5 : 5), phase * 0.07),
    bodyPath: buildInkRibbonPath(pathPoints, roadHalf, phase * 0.07),
    cardWidth,
    center,
    corePath: buildInkRibbonPath(pathPoints, roadHalf * 0.72, phase * 0.07 + 1.4),
    height,
    mobile,
    path: smoothPath(pathPoints),
    pathPoints,
    roadHalf,
    width,
  };
}

function sameHeights(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
) {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

export default function InkRoadTimeline({
  activeKey,
  canRevise,
  entries,
  onRevise,
  onSelect,
  recentlySavedKey,
}: {
  activeKey: string | null;
  canRevise: boolean;
  entries: TimelineDraftEntry[];
  onRevise: (entry: TimelineDraftEntry) => void;
  onSelect: (entry: TimelineDraftEntry) => boolean;
  recentlySavedKey: string | null;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const [width, setWidth] = useState(0);
  const [cardHeights, setCardHeights] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const rawId = useId().replaceAll(":", "");
  const roughId = `${rawId}-ink-rough`;
  const bleedId = `${rawId}-ink-bleed`;
  const layout = useMemo(
    () => buildInkRoadLayout(entries, activeKey, width, cardHeights),
    [activeKey, cardHeights, entries, width],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const syncWidth = () => setWidth(Math.round(stage.getBoundingClientRect().width));
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const entry of entries) {
      const element = itemRefs.current.get(entry.clientKey);
      if (element) next.set(entry.clientKey, Math.ceil(element.getBoundingClientRect().height));
    }
    setCardHeights((current) => (sameHeights(current, next) ? current : next));
  }, [activeKey, entries, width]);

  const itemRef = (key: string): RefCallback<HTMLLIElement> => (node) => {
    if (node) itemRefs.current.set(key, node);
    else itemRefs.current.delete(key);
  };

  function onRoadKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + direction + entries.length) % entries.length;
    const next = entries[nextIndex];
    if (!next) return;
    if (!onSelect(next)) return;
    const button = stageRef.current?.querySelector<HTMLButtonElement>(
      `[data-road-key="${CSS.escape(next.clientKey)}"]`,
    );
    button?.focus();
  }

  if (!entries.length) {
    return (
      <div className={styles.stageEmpty}>
        <span aria-hidden="true" className={styles.stageMark}>V.01</span>
        <p>Add one year and one title to generate the road.</p>
      </div>
    );
  }

  const filtersEnabled = entries.length <= 24 && layout.height <= 4800;
  const bleedEnabled = filtersEnabled && (!layout.mobile || layout.height <= 3200);
  const pathXs = layout.pathPoints.map((point) => point.x);
  const filterX = Math.floor(Math.min(...pathXs) - 72);
  const filterWidth = Math.ceil(Math.max(...pathXs) - Math.min(...pathXs) + 144);

  return (
    <div
      className={`${styles.stage} ${layout.mobile ? styles.stageMobile : ""}`}
      ref={stageRef}
      style={{ height: layout.height }}
    >
      <span aria-hidden="true" className={styles.stageMark}>V.01</span>
      <svg
        aria-hidden="true"
        className={styles.roadSvg}
        focusable="false"
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        <defs>
          <filter
            colorInterpolationFilters="sRGB"
            filterUnits="userSpaceOnUse"
            height={layout.height + 144}
            id={roughId}
            primitiveUnits="userSpaceOnUse"
            width={filterWidth}
            x={filterX}
            y={-72}
          >
            <feTurbulence
              baseFrequency="0.012 0.16"
              numOctaves="2"
              result="warp"
              seed="37"
              stitchTiles="stitch"
              type="fractalNoise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="warp"
              scale="2.4"
              xChannelSelector="R"
              yChannelSelector="B"
            />
          </filter>
          <filter
            colorInterpolationFilters="sRGB"
            filterUnits="userSpaceOnUse"
            height={layout.height + 144}
            id={bleedId}
            primitiveUnits="userSpaceOnUse"
            width={filterWidth}
            x={filterX}
            y={-72}
          >
            <feTurbulence
              baseFrequency="0.008 0.1"
              numOctaves="2"
              result="bleedNoise"
              seed="71"
              stitchTiles="stitch"
              type="fractalNoise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="bleedNoise"
              result="brokenEdge"
              scale="3.2"
              xChannelSelector="G"
              yChannelSelector="R"
            />
            <feGaussianBlur in="brokenEdge" result="softEdge" stdDeviation="0.85" />
            <feComponentTransfer in="softEdge">
              <feFuncA slope="0.24" type="linear" />
            </feComponentTransfer>
          </filter>
        </defs>

        <g className={styles.inkTrail}>
          <path
            className={styles.inkBleed}
            d={layout.bleedPath}
            filter={bleedEnabled ? `url(#${bleedId})` : undefined}
          />
          <g filter={filtersEnabled ? `url(#${roughId})` : undefined}>
            <path className={styles.inkBody} d={layout.bodyPath} />
            <path className={styles.inkCore} d={layout.corePath} />
          </g>
          <path
            className={styles.inkDryCut}
            d={layout.path}
            pathLength="1000"
            strokeDasharray="1 91 3 143 1 117 5 211 2 239 3 187"
          />
          <path className={styles.inkFallback} d={layout.path} />
        </g>

        <g className={styles.inkPools} filter={filtersEnabled ? `url(#${roughId})` : undefined}>
          {layout.anchors.map((anchor, index) => (
            <ellipse
              className={styles.inkPool}
              cx={anchor.x}
              cy={anchor.y}
              key={`${anchor.entry.clientKey}-pool`}
              rx={layout.roadHalf * (0.76 + (index % 3) * 0.055)}
              ry={layout.roadHalf * (0.84 + ((index + 1) % 3) * 0.045)}
              transform={`rotate(${index % 2 === 0 ? -12 : 9} ${anchor.x} ${anchor.y})`}
            />
          ))}
        </g>

        <g className={styles.inkSpecks}>
          {layout.anchors.flatMap((anchor, index) => {
            const signature = [...anchor.entry.clientKey].reduce((value, character) => value + character.charCodeAt(0), 0);
            if (index === 0 || index === layout.anchors.length - 1 || signature % 4 > 1) return [];
            const cardIsRight = layout.mobile || anchor.x < layout.center;
            const direction = cardIsRight ? -1 : 1;
            const cluster = layout.mobile
              ? [{ dx: 18, dy: 7, rotate: 0, rx: 1.1, ry: 1.1 }]
              : [
                  { dx: 12, dy: -18, rotate: 18, rx: 2.1, ry: 3.6 },
                  { dx: 25, dy: 7, rotate: 0, rx: 1.1, ry: 1.1 },
                  { dx: 17, dy: 22, rotate: -24, rx: 0.8, ry: 1.7 },
                ];
            return cluster.map((mark, markIndex) => {
              const cx = anchor.x + direction * (layout.roadHalf + mark.dx);
              const cy = anchor.y + mark.dy;
              return (
                <ellipse
                  className={styles.inkSpeck}
                  cx={cx}
                  cy={cy}
                  key={`${anchor.entry.clientKey}-speck-${markIndex}`}
                  rx={mark.rx}
                  ry={mark.ry}
                  transform={`rotate(${direction * mark.rotate} ${cx} ${cy})`}
                />
              );
            });
          })}
        </g>

        <text
          className={styles.roadLabel}
          x={Math.min(layout.width - 12, roadXAt(34, layout.height, layout.width, layout.mobile) + (layout.mobile ? 30 : 48))}
          y="28"
        >
          BEGINNING
        </text>
        <text
          className={styles.roadLabel}
          textAnchor={layout.mobile ? "end" : "start"}
          x={layout.mobile ? layout.width - 12 : Math.min(layout.width - 12, roadXAt(layout.height - 30, layout.height, layout.width, false) + 48)}
          y={layout.height - 20}
        >
          NOW
        </text>

        {layout.anchors.map((anchor) => {
          const cardEdge = anchor.putRight
            ? anchor.cardLeft
            : anchor.cardLeft + anchor.cardWidth;
          return (
            <g key={`road-${anchor.entry.clientKey}`}>
              {anchor.selected ? (
                <ellipse
                  className={styles.inkBloom}
                  cx={anchor.roadEdge}
                  cy={anchor.y}
                  filter={filtersEnabled ? `url(#${roughId})` : undefined}
                  rx={layout.mobile ? 13 : 19}
                  ry={layout.mobile ? 17 : 23}
                  transform={`rotate(${anchor.putRight ? -16 : 16} ${anchor.roadEdge} ${anchor.y})`}
                />
              ) : null}
              <polygon
                className={`${styles.connector} ${anchor.selected ? styles.connectorSelected : ""}`}
                points={`${anchor.roadEdge},${anchor.y - (anchor.selected ? 1.3 : 0.75)} ${cardEdge},${anchor.y - 0.25} ${cardEdge},${anchor.y + 0.25} ${anchor.roadEdge},${anchor.y + (anchor.selected ? 1.3 : 0.75)}`}
              />
              <rect
                className={`${styles.node} ${anchor.selected ? styles.nodeSelected : ""}`}
                height="20"
                width="12"
                x={anchor.roadEdge - 6}
                y={anchor.y - 10}
              />
            </g>
          );
        })}
      </svg>

      <ol className={styles.roadEvents}>
        {layout.anchors.map((anchor) => (
          <li
            className={`${styles.roadEventItem} ${anchor.putRight ? styles.eventRight : styles.eventLeft} ${anchor.selected ? styles.eventActive : ""}`}
            key={anchor.entry.clientKey}
            ref={itemRef(anchor.entry.clientKey)}
            style={{
              left: anchor.cardLeft,
              top: anchor.cardTop,
              visibility: width ? "visible" : "hidden",
              width: anchor.cardWidth,
            }}
          >
            <button
              aria-expanded={anchor.selected}
              aria-label={`Open ${anchor.entry.title} on the generated timeline`}
              className={`${styles.roadEvent} ${anchor.selected ? styles.roadEventSelected : ""}`}
              data-road-key={anchor.entry.clientKey}
              onClick={() => onSelect(anchor.entry)}
              onKeyDown={(event) => onRoadKeyDown(event, anchor.index)}
              type="button"
            >
              <span className={styles.eventMeta}>
                <span className={styles.eventIndex}>
                  {recentlySavedKey === anchor.entry.clientKey ? "SAVED / " : ""}
                  {String(anchor.index + 1).padStart(2, "0")}
                </span>
                <span className={styles.eventDate}>{anchor.entry.year}</span>
              </span>
              <span className={styles.eventTitle}>{anchor.entry.title}</span>
              {anchor.selected && anchor.entry.details.trim() ? (
                <span className={styles.eventDetail}>{anchor.entry.details}</span>
              ) : null}
            </button>
            {anchor.selected && canRevise ? (
              <button
                aria-label={`Revise ${anchor.entry.title}`}
                className={styles.reviseEvent}
                onClick={() => onRevise(anchor.entry)}
                type="button"
              >
                Revise
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
