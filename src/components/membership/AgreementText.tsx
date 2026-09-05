import type { ReactNode } from "react";

function inlineText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <strong className="font-semibold text-white/90" key={index}>{part.slice(2, -2)}</strong>
      : part,
  );
}

/** Presentation only: the published body and its acceptance hash stay untouched.
 * Only section headings and bold text are supported; everything else remains
 * escaped React text, never HTML or executable/link markup.
 */
export default function AgreementText({ body }: { body: string }) {
  const blocks: Array<{ heading: boolean; text: string }> = [];
  let paragraph: string[] = [];
  function finishParagraph() {
    if (!paragraph.length) return;
    blocks.push({ heading: false, text: paragraph.join(" ") });
    paragraph = [];
  }

  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^#{1,6} (.+)$/.exec(line);
    if (!line.trim() || heading) finishParagraph();
    if (heading) blocks.push({ heading: true, text: heading[1] });
    else if (line.trim()) paragraph.push(line);
  }
  finishParagraph();

  return (
    <div className="grid gap-4 font-[var(--font-body)] text-sm leading-7 text-white/72 [overflow-wrap:anywhere]">
      {blocks.map((block, index) => block.heading ? (
        <h4 className="mt-3 text-base font-semibold leading-snug text-white first:mt-0" key={index}>
          {inlineText(block.text)}
        </h4>
      ) : <p key={index}>{inlineText(block.text)}</p>)}
    </div>
  );
}
