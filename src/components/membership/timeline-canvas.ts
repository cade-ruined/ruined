import {
  buildTimelineArtworkLayout,
  seededRandom,
  type TimelineArtworkFormat,
  type TimelineArtworkPage,
  type TimelineArtworkPoint,
} from "@/components/membership/timeline-artwork";
import type { TimelineDraftEntry } from "@/components/membership/timeline-model";

export const TIMELINE_PAPER_SRC = "/textures/ruined-timeline-paper.png";

const BONE = "#E5E0D5";
const FADED = "#2A2A2A";
const INK = "#0A0A09";
const POSTER = "#D0312D";

export type TimelineArtworkFonts = {
  body: string;
  hand: string;
  header: string;
};

export type TimelineArtworkRenderOptions = {
  canvas: HTMLCanvasElement;
  entries: TimelineDraftEntry[];
  examples: boolean;
  fonts: TimelineArtworkFonts;
  format: TimelineArtworkFormat;
  page: TimelineArtworkPage;
  paper: HTMLImageElement;
};

export function readTimelineArtworkFonts(): TimelineArtworkFonts {
  const styles = window.getComputedStyle(document.documentElement);
  return {
    body:
      styles.getPropertyValue("--font-body").trim() ||
      'Inter, "Helvetica Neue", Arial, sans-serif',
    hand:
      styles.getPropertyValue("--font-cadehandy2").trim() ||
      '"CadeHandy", "Segoe Print", cursive',
    header:
      styles.getPropertyValue("--font-header").trim() ||
      'Inter, "Helvetica Neue", Arial, sans-serif',
  };
}

export function previewTimelineArtworkFormat(
  format: TimelineArtworkFormat,
  maximumSide = 920,
): TimelineArtworkFormat {
  const scale = Math.min(1, maximumSide / Math.max(format.width, format.height));
  return {
    ...format,
    height: Math.max(1, Math.round(format.height * scale)),
    width: Math.max(1, Math.round(format.width * scale)),
  };
}

export function loadTimelinePaper() {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The Timeline paper could not be loaded."));
    image.src = TIMELINE_PAPER_SRC;
  });
}

function drawCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;

  if (sourceRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = image.naturalWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}

function drawPaper(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  seed: number,
) {
  context.fillStyle = BONE;
  context.fillRect(0, 0, width, height);
  context.save();
  context.globalAlpha = 0.82;
  context.globalCompositeOperation = "multiply";
  if (width > height) {
    context.translate(width / 2, height / 2);
    context.rotate(-Math.PI / 2);
    drawCover(context, image, -height / 2, -width / 2, height, width);
  } else {
    drawCover(context, image, 0, 0, width, height);
  }
  context.restore();

  const random = seededRandom(seed ^ 0x4f1bbcdc);
  const grainCount = Math.min(5600, Math.round((width * height) / 2100));
  context.save();
  context.globalCompositeOperation = "multiply";
  for (let index = 0; index < grainCount; index += 1) {
    const alpha = 0.012 + random() * 0.034;
    const size = 0.35 + random() * Math.max(0.7, Math.min(width, height) * 0.00055);
    context.fillStyle = `rgba(18, 16, 13, ${alpha})`;
    context.fillRect(random() * width, random() * height, size, size * (0.45 + random()));
  }
  context.restore();
}

export function sampleTimelineCurve(
  controls: TimelineArtworkPoint[],
  samplesPerSegment = 24,
) {
  if (controls.length < 2) return [...controls];
  const samples: TimelineArtworkPoint[] = [];
  for (let index = 0; index < controls.length - 1; index += 1) {
    const p0 = controls[Math.max(0, index - 1)]!;
    const p1 = controls[index]!;
    const p2 = controls[index + 1]!;
    const p3 = controls[Math.min(controls.length - 1, index + 2)]!;
    for (let step = 0; step < samplesPerSegment; step += 1) {
      const t = step / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      samples.push({
        x:
          0.5 *
          ((2 * p1.x) +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          ((2 * p1.y) +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  samples.push(controls.at(-1)!);
  return samples;
}

function strokeSamples(
  context: CanvasRenderingContext2D,
  samples: TimelineArtworkPoint[],
) {
  const first = samples[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < samples.length; index += 1) {
    const point = samples[index]!;
    context.lineTo(point.x, point.y);
  }
  context.stroke();
}

function drawInkBlob(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  random: () => number,
) {
  const points = 14;
  context.beginPath();
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const localRadius = radius * (0.83 + random() * 0.28);
    const pointX = x + Math.cos(angle) * localRadius;
    const pointY = y + Math.sin(angle) * localRadius * (0.82 + random() * 0.22);
    if (index === 0) context.moveTo(pointX, pointY);
    else context.lineTo(pointX, pointY);
  }
  context.closePath();
  context.fill();
}

function drawInk(
  context: CanvasRenderingContext2D,
  samples: TimelineArtworkPoint[],
  eventPoints: TimelineArtworkPoint[],
  width: number,
  height: number,
  seed: number,
  flow: "horizontal" | "vertical",
) {
  const documentRef = context.canvas.ownerDocument;
  const inkCanvas = documentRef.createElement("canvas");
  inkCanvas.width = width;
  inkCanvas.height = height;
  const ink = inkCanvas.getContext("2d");
  if (!ink || samples.length < 2) return;

  const random = seededRandom(seed ^ 0x9e3779b9);
  const baseWidth = Math.min(width, height) * 0.043;
  ink.lineCap = "round";
  ink.lineJoin = "round";

  ink.save();
  ink.filter = `blur(${Math.max(1.2, baseWidth * 0.035)}px)`;
  ink.lineWidth = baseWidth * 1.14;
  ink.strokeStyle = "rgba(10, 10, 9, 0.19)";
  strokeSamples(ink, samples);
  ink.restore();

  const phase = random() * Math.PI * 2;
  for (let index = 0; index < samples.length - 1; index += 1) {
    const current = samples[index]!;
    const next = samples[index + 1]!;
    const rawPressure =
      0.82 +
      Math.sin(index * 0.29 + phase) * 0.105 +
      Math.sin(index * 0.071 + phase * 0.7) * 0.075 +
      (random() - 0.5) * 0.09;
    const edgeDistance = Math.min(current.x, width - current.x);
    const edgeBlend =
      flow === "horizontal"
        ? Math.max(0, Math.min(1, edgeDistance / (width * 0.11)))
        : 1;
    const pressure = 1 + (rawPressure - 1) * edgeBlend;
    ink.beginPath();
    ink.moveTo(current.x, current.y);
    ink.lineTo(next.x, next.y);
    ink.lineWidth = baseWidth * pressure;
    ink.strokeStyle = `rgba(8, 8, 7, ${0.965 + (random() - 0.5) * 0.055 * edgeBlend})`;
    ink.stroke();
  }

  ink.save();
  ink.globalAlpha = 0.17;
  ink.lineWidth = baseWidth * 0.68;
  ink.strokeStyle = INK;
  strokeSamples(ink, samples);
  ink.restore();

  ink.fillStyle = INK;
  for (const point of eventPoints) {
    if (random() > 0.78) continue;
    ink.save();
    ink.globalAlpha = 0.2 + random() * 0.17;
    drawInkBlob(ink, point.x, point.y, baseWidth * (0.5 + random() * 0.18), random);
    ink.restore();
  }

  ink.save();
  ink.globalCompositeOperation = "destination-out";
  for (let index = 4; index < samples.length - 4; index += 2 + Math.floor(random() * 5)) {
    const point = samples[index]!;
    if (
      flow === "horizontal" &&
      (point.x < width * 0.11 || point.x > width * 0.89)
    ) {
      continue;
    }
    const previous = samples[index - 1]!;
    const next = samples[index + 1]!;
    const angle = Math.atan2(next.y - previous.y, next.x - previous.x);
    const normalX = -Math.sin(angle);
    const normalY = Math.cos(angle);
    const offset = (random() - 0.5) * baseWidth * 0.72;
    ink.save();
    ink.translate(point.x + normalX * offset, point.y + normalY * offset);
    ink.rotate(angle + (random() - 0.5) * 0.28);
    ink.globalAlpha = 0.07 + random() * 0.16;
    ink.beginPath();
    ink.ellipse(
      0,
      0,
      baseWidth * (0.025 + random() * 0.105),
      baseWidth * (0.005 + random() * 0.018),
      0,
      0,
      Math.PI * 2,
    );
    ink.fill();
    ink.restore();
  }

  for (const point of eventPoints) {
    ink.globalAlpha = 0.94;
    ink.fillRect(
      point.x - baseWidth * 0.075,
      point.y - baseWidth * 0.27,
      baseWidth * 0.15,
      baseWidth * 0.54,
    );
  }
  ink.restore();

  ink.save();
  ink.fillStyle = INK;
  for (let index = 1; index < eventPoints.length - 1; index += 1) {
    if (random() > 0.36) continue;
    const point = eventPoints[index]!;
    const direction = random() > 0.5 ? 1 : -1;
    const count = 1 + Math.floor(random() * 3);
    for (let mark = 0; mark < count; mark += 1) {
      ink.globalAlpha = 0.36 + random() * 0.48;
      ink.beginPath();
      ink.ellipse(
        point.x + direction * baseWidth * (0.7 + random() * 0.62),
        point.y + (random() - 0.5) * baseWidth * 1.15,
        baseWidth * (0.008 + random() * 0.026),
        baseWidth * (0.008 + random() * 0.04),
        random() * Math.PI,
        0,
        Math.PI * 2,
      );
      ink.fill();
    }
  }
  ink.restore();

  context.save();
  context.globalAlpha = 0.96;
  context.globalCompositeOperation = "multiply";
  context.drawImage(inkCanvas, 0, 0);
  context.restore();
  inkCanvas.width = 1;
  inkCanvas.height = 1;
}

function wrapText(
  context: CanvasRenderingContext2D,
  value: string,
  maximumWidth: number,
  maximumLines: number,
) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maximumWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maximumLines) break;
  }
  if (line && lines.length < maximumLines) lines.push(line);
  if (lines.length === maximumLines) {
    const consumed = lines.join(" ");
    if (consumed.length < value.trim().length) {
      let finalLine = lines.at(-1) ?? "";
      while (finalLine && context.measureText(`${finalLine}…`).width > maximumWidth) {
        finalLine = finalLine.slice(0, -1);
      }
      lines[lines.length - 1] = `${finalLine.trimEnd()}…`;
    }
  }
  return lines;
}

function drawLabel({
  context,
  event,
  fonts,
  baseWidth,
  scale,
}: {
  baseWidth: number;
  context: CanvasRenderingContext2D;
  event: ReturnType<typeof buildTimelineArtworkLayout>["events"][number];
  fonts: TimelineArtworkFonts;
  scale: number;
}) {
  if (event.labelSide === "above" || event.labelSide === "below") {
    const direction = event.labelSide === "above" ? -1 : 1;
    const metaSize = 23 * scale;
    const titleSize = 49 * scale;
    const detailSize = 23 * scale;
    const blockTop =
      event.labelY ??
      event.point.y + direction * (event.labelSide === "above" ? 250 : 112) * scale;
    const connectorStart =
      event.point.y + direction * Math.max(baseWidth * 0.56, 48 * scale);
    const connectorEnd =
      event.labelSide === "above"
        ? Math.min(connectorStart - 12 * scale, blockTop + 184 * scale)
        : Math.max(connectorStart + 12 * scale, blockTop - 54 * scale);

    context.save();
    context.strokeStyle = "rgba(42, 42, 42, 0.62)";
    context.lineWidth = Math.max(1.4, scale * 1.7);
    context.beginPath();
    context.moveTo(event.point.x, connectorStart);
    context.lineTo(event.point.x, connectorEnd);
    context.stroke();

    context.fillStyle = POSTER;
    context.font = `800 ${metaSize}px ${fonts.header}`;
    context.textBaseline = "alphabetic";
    context.fillText(
      `${String(event.entry.position).padStart(2, "0")} / ${event.entry.year}`,
      event.labelX,
      blockTop,
    );

    context.fillStyle = FADED;
    context.font = `900 ${titleSize}px ${fonts.header}`;
    const titleLines = wrapText(
      context,
      event.entry.title.toUpperCase(),
      event.labelWidth,
      2,
    );
    let cursorY = blockTop + titleSize * 1.05;
    for (const line of titleLines) {
      context.fillText(line, event.labelX, cursorY);
      cursorY += titleSize * 0.88;
    }

    if (event.entry.details.trim()) {
      context.fillStyle = "rgba(42, 42, 42, 0.67)";
      context.font = `500 ${detailSize}px ${fonts.body}`;
      const detailLines = wrapText(
        context,
        event.entry.details,
        event.labelWidth,
        2,
      );
      cursorY += detailSize * 0.35;
      for (const line of detailLines) {
        context.fillText(line, event.labelX, cursorY);
        cursorY += detailSize * 1.25;
      }
    }
    context.restore();
    return;
  }

  const connectorEnd =
    event.labelSide === "left" ? event.labelX + event.labelWidth : event.labelX;
  const roadEdge =
    event.point.x + (event.labelSide === "left" ? -baseWidth * 0.55 : baseWidth * 0.55);
  context.save();
  context.strokeStyle = "rgba(42, 42, 42, 0.62)";
  context.lineWidth = Math.max(1.4, scale * 1.7);
  context.beginPath();
  context.moveTo(roadEdge, event.point.y);
  context.lineTo(connectorEnd, event.point.y);
  context.stroke();

  const metaSize = 23 * scale;
  const titleSize = 49 * scale;
  const detailSize = 23 * scale;
  const blockTop = event.point.y - 47 * scale;
  context.fillStyle = POSTER;
  context.font = `800 ${metaSize}px ${fonts.header}`;
  context.textBaseline = "alphabetic";
  context.fillText(
    `${String(event.entry.position).padStart(2, "0")} / ${event.entry.year}`,
    event.labelX,
    blockTop,
  );

  context.fillStyle = FADED;
  context.font = `900 ${titleSize}px ${fonts.header}`;
  const titleLines = wrapText(
    context,
    event.entry.title.toUpperCase(),
    event.labelWidth,
    2,
  );
  let cursorY = blockTop + titleSize * 1.05;
  for (const line of titleLines) {
    context.fillText(line, event.labelX, cursorY);
    cursorY += titleSize * 0.88;
  }

  if (event.entry.details.trim()) {
    context.fillStyle = "rgba(42, 42, 42, 0.67)";
    context.font = `500 ${detailSize}px ${fonts.body}`;
    const detailLines = wrapText(
      context,
      event.entry.details,
      event.labelWidth,
      2,
    );
    cursorY += detailSize * 0.35;
    for (const line of detailLines) {
      context.fillText(line, event.labelX, cursorY);
      cursorY += detailSize * 1.25;
    }
  }
  context.restore();
}

function spanFor(entries: TimelineDraftEntry[]) {
  const first = entries[0];
  const last = entries.at(-1);
  if (!first || !last) return "NO EVENTS";
  return first.year === last.year ? String(first.year) : `${first.year}—${last.year}`;
}

export function renderTimelineArtwork({
  canvas,
  entries,
  examples,
  fonts,
  format,
  page,
  paper,
}: TimelineArtworkRenderOptions) {
  canvas.width = format.width;
  canvas.height = format.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser cannot prepare the Timeline artwork.");
  const layout = buildTimelineArtworkLayout({
    entries: page.entries,
    format,
    pageIndex: page.index,
    sequenceEntries: entries,
  });
  const scale = Math.min(format.width, format.height) / 2160;
  drawPaper(context, paper, format.width, format.height, layout.seed);

  const titleX = layout.marginX;
  const titleY = format.height * (layout.landscape ? 0.108 : 0.083);
  context.fillStyle = FADED;
  context.font = `800 ${24 * scale}px ${fonts.header}`;
  if (layout.flow === "horizontal" && page.index > 0) {
    context.fillText("RUINED / THE TIMELINE", titleX, titleY - 24 * scale);
    context.fillStyle = POSTER;
    context.font = `400 ${46 * scale}px ${fonts.hand}`;
    context.fillText(
      `page ${String(page.index + 1).padStart(2, "0")}`,
      titleX + 3 * scale,
      titleY + 34 * scale,
    );
  } else {
    context.fillText("RUINED / FOUNDATIONS", titleX, titleY - 74 * scale);
    context.font = `900 ${layout.landscape ? 148 * scale : 138 * scale}px ${fonts.header}`;
    context.fillText("THE TIMELINE", titleX, titleY + 52 * scale);
    context.fillStyle = POSTER;
    context.font = `400 ${54 * scale}px ${fonts.hand}`;
    context.fillText("A life, in order.", titleX + 4 * scale, titleY + 112 * scale);
  }

  context.save();
  context.textAlign = "right";
  context.fillStyle = "rgba(42, 42, 42, 0.68)";
  context.font = `800 ${22 * scale}px ${fonts.header}`;
  context.fillText(
    `${examples ? "EXAMPLE / " : ""}${entries.length} ${entries.length === 1 ? "EVENT" : "EVENTS"}`,
    format.width - layout.marginX,
    titleY - 28 * scale,
  );
  context.fillText(
    `${spanFor(entries)} / ${String(page.index + 1).padStart(2, "0")} OF ${String(page.total).padStart(2, "0")}`,
    format.width - layout.marginX,
    titleY + 9 * scale,
  );
  context.restore();

  const samples = sampleTimelineCurve(layout.pathControls);
  drawInk(
    context,
    samples,
    layout.inkPoints,
    format.width,
    format.height,
    layout.seed,
    layout.flow,
  );

  const baseWidth = Math.min(format.width, format.height) * 0.043;
  for (const event of layout.events) {
    drawLabel({ context, event, fonts, baseWidth, scale });
  }

  context.save();
  context.fillStyle = "rgba(42, 42, 42, 0.62)";
  context.font = `800 ${19 * scale}px ${fonts.header}`;
  if (layout.flow === "horizontal") {
    if (page.index === 0) {
      context.fillText(
        "BEGINNING →",
        layout.marginX,
        layout.headerY - baseWidth * 0.82,
      );
    }
    context.textAlign = "right";
    if (page.index === page.total - 1) {
      context.fillText(
        "NOW",
        format.width - layout.marginX,
        layout.footerY + baseWidth * 1.02,
      );
    }
  } else {
    context.fillText(
      page.index === 0 ? "BEGINNING" : "CONTINUED",
      Math.max(layout.marginX, layout.pathControls[0]!.x - baseWidth * 1.25),
      layout.headerY - 54 * scale,
    );
    context.textAlign = "right";
    context.fillText(
      page.index === page.total - 1 ? "NOW" : "CONTINUES",
      Math.min(
        format.width - layout.marginX,
        layout.pathControls.at(-1)!.x + baseWidth * 1.25,
      ),
      layout.footerY + 82 * scale,
    );
  }
  context.restore();
}

export function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The PNG could not be prepared."));
    }, "image/png");
  });
}
