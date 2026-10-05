import type { ReactNode } from "react";

/** A small, deliberately text-only format. Stored content never becomes HTML. */
export default function OperatorSopBody({ body }: { body: string }) {
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push(<h3 className="!font-[var(--font-body)] !text-lg !font-semibold !tracking-tight" key={index}>{heading[2]}</h3>);
      index += 1;
      continue;
    }
    const list = line.match(/^\s*(?:(\d+)[.)]|([-*]))\s+(.+)$/);
    if (list) {
      const start = index;
      const ordered = Boolean(list[1]);
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:(\d+)[.)]|([-*]))\s+(.+)$/);
        if (!item || Boolean(item[1]) !== ordered) break;
        items.push(<li className="pl-1" key={index}>{item[3]}</li>);
        index += 1;
      }
      blocks.push(ordered
        ? <ol className="list-decimal space-y-2 pl-6 marker:text-black/45" key={start} start={Number(list[1])}>{items}</ol>
        : <ul className="list-disc space-y-2 pl-6 marker:text-black/45" key={start}>{items}</ul>);
      continue;
    }
    const start = index;
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (index > start && /^\s*(?:#{1,6}\s|(?:\d+[.)]|[-*])\s)/.test(lines[index])) break;
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p className="whitespace-pre-line" key={start}>{paragraph.join("\n")}</p>);
  }
  return <div className="space-y-5 break-words text-[0.95rem] leading-7 [overflow-wrap:anywhere]">{blocks}</div>;
}

export function safeSopDocumentUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
