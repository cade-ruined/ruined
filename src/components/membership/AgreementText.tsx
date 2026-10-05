import type { ReactNode } from "react";

function inlineText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <strong className="font-semibold text-white/90" key={index}>{part.slice(2, -2)}</strong>
      : part,
  );
}

type AgreementBlock = { kind: "heading" | "paragraph"; text: string }
  | { kind: "table"; headings: string[]; rows: string[][] };
const tableCells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());

/** Presentation only: source and acceptance hash stay untouched. Supported
 * headings, bold and simple tables render as native elements. Other markup is
 * escaped text, never HTML or executable links. */
export default function AgreementText({ body }: { body: string }) {
  const blocks: AgreementBlock[] = [];
  let paragraph: string[] = [];
  function finishParagraph() {
    if (!paragraph.length) return;
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  }

  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim().startsWith("|") && lines[index + 1]?.trim().startsWith("|")) {
      const headings = tableCells(line), separator = tableCells(lines[index + 1]);
      if (headings.length > 1 && headings.length === separator.length && separator.every(cell => /^:?-{3,}:?$/.test(cell))) {
        let end = index + 2;
        const rows: string[][] = [];
        while (end < lines.length && lines[end].trim().startsWith("|")) rows.push(tableCells(lines[end++]));
        // Malformed rows remain source text rather than silently losing cells.
        if (rows.length && rows.every(row => row.length === headings.length)) {
          finishParagraph();
          blocks.push({ kind: "table", headings, rows });
          index = end - 1;
          continue;
        }
      }
    }
    const heading = /^#{1,6} (.+)$/.exec(line);
    if (!line.trim() || heading) finishParagraph();
    if (heading) blocks.push({ kind: "heading", text: heading[1] });
    else if (line.trim()) paragraph.push(line);
  }
  finishParagraph();

  return (
    <div className="grid min-w-0 gap-4 font-[var(--font-body)] text-sm leading-7 text-white/72 [overflow-wrap:anywhere]">
      {blocks.map((block, index) => block.kind === "table" ? (
        <div className="min-w-0 overflow-x-auto border border-white/20" key={index} role="region" aria-label="Agreement pricing and payment table" tabIndex={0}>
          <table className="w-full min-w-[42rem] border-collapse text-left text-xs leading-6">
            <thead><tr>{block.headings.map((heading, column) => <th className="border-b border-white/20 bg-white/5 p-3 align-top font-semibold text-white" scope="col" key={column}>{inlineText(heading)}</th>)}</tr></thead>
            <tbody>{block.rows.map((row, rowIndex) => <tr className="border-b border-white/10 last:border-b-0" key={rowIndex}>
              {row.map((cell, column) => column === 0 ? <th className="p-3 align-top font-medium text-white/90" scope="row" key={column}>{inlineText(cell)}</th> : <td className="p-3 align-top" key={column}>{inlineText(cell)}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
      ) : block.kind === "heading" ? (
        <h4 className="mt-3 text-base font-semibold leading-snug text-white first:mt-0" key={index}>
          {inlineText(block.text)}
        </h4>
      ) : <p key={index}>{inlineText(block.text)}</p>)}
    </div>
  );
}
