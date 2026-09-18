export type CardTextLayout = { lines: string[]; size: number; lineHeight: number; height: number; overflow: boolean };

/** Breaks long names as well as ordinary words, without discarding characters. */
export function wrapCardText(value: string, width: number, measure: (value: string) => number): string[] {
  const result: string[] = [];
  let line = "";
  for (const word of value.trim().split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (measure(test) <= width) { line = test; continue; }
    if (line) result.push(line);
    line = "";
    for (const character of Array.from(word)) {
      if (line && measure(line + character) > width) { result.push(line); line = character; }
      else line += character;
    }
  }
  if (line) result.push(line);
  return result;
}

export function fitCardText(value: string, options: {
  width: number; height: number; maxSize: number; minSize: number; leading?: number;
  measure: (value: string, size: number) => number;
}): CardTextLayout {
  const leading = options.leading ?? 1.2;
  let size = options.maxSize;
  let lines: string[];
  do {
    lines = wrapCardText(value, options.width, (text) => options.measure(text, size));
    if (lines.length * size * leading <= options.height || size <= options.minSize) break;
    size = Math.max(options.minSize, size - 2);
  } while (true);
  const lineHeight = size * leading;
  return { lines, size, lineHeight, height: lines.length * lineHeight, overflow: lines.length * lineHeight > options.height };
}

/** Only secondary text may be abbreviated; its complete value remains in HTML. */
export function abbreviateCardText(layout: CardTextLayout, maxLines: number, width: number, measure: (value: string, size: number) => number): CardTextLayout {
  if (layout.lines.length <= maxLines) return layout;
  const lines = layout.lines.slice(0, maxLines);
  let last = Array.from(lines[maxLines - 1]);
  while (last.length && measure(`${last.join("")}…`, layout.size) > width) last = last.slice(0, -1);
  lines[maxLines - 1] = `${last.join("").trimEnd()}…`;
  return { ...layout, lines, height: maxLines * layout.lineHeight, overflow: true };
}
