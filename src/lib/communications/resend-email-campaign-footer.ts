import { parse, type DefaultTreeAdapterTypes } from "parse5";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const UNSUBSCRIBE = "{{{RESEND_UNSUBSCRIBE_URL}}}";
const MARKER = /^\{\{\{\s*RESEND_UNSUBSCRIBE_URL\s*\}\}\}$/;
const BLOCKED = new Set(["head", "script", "style", "textarea", "iframe", "object", "embed", "svg", "math", "template", "noscript"]);
const attr = (node: Element, name: string) => node.attrs.find(item => item.name === name)?.value;
function hidden(node: Element): boolean {
  if (node.attrs.some(item => item.name === "hidden" || item.name === "inert"
    || item.name === "aria-hidden" && item.value.toLowerCase() === "true")) return true;
  const style = attr(node, "style") ?? "";
  const end = "(?:\\s*!important)?\\s*(?:;|$)";
  if (new RegExp("(?:^|;)\\s*(?:display\\s*:\\s*none|visibility\\s*:\\s*(?:hidden|collapse)|mso-hide\\s*:\\s*all)" + end, "i").test(style)) return true;
  if (new RegExp("(?:^|;)\\s*opacity\\s*:\\s*(?:0(?:\\.0+)?|\\.0+)%?" + end, "i").test(style)) return true;
  return new RegExp("(?:^|;)\\s*(?:max-)?height\\s*:\\s*0(?:px|em|rem|pt|%)?" + end, "i").test(style)
    && new RegExp("(?:^|;)\\s*overflow(?:-y)?\\s*:\\s*(?:hidden|clip)" + end, "i").test(style);
}
function visibleElements(html: string) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const elements: Element[] = [];
  function visit(node: Node) {
    if ("tagName" in node) {
      if (BLOCKED.has(node.tagName) || hidden(node)) return;
      elements.push(node);
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  }
  visit(document);
  return elements;
}
function zeroFont(node: Node): boolean {
  let current: Node | null | undefined = node;
  while (current) {
    if ("tagName" in current) {
      const declarations = [...(attr(current, "style") ?? "").matchAll(/(?:^|;)\s*font-size\s*:\s*([^;]+)/gi)];
      const value = declarations.at(-1)?.[1].replace(/\s*!important\s*$/i, "").trim();
      if (value && !/^(?:inherit|unset)$/i.test(value)) return /^(?:0(?:\.0+)?|\.0+)(?:px|em|rem|pt|%)?$/i.test(value);
    }
    current = "parentNode" in current ? current.parentNode : undefined;
  }
  return false;
}
function hasLabel(node: Node, visible: Set<Element>): boolean {
  if ("tagName" in node && !visible.has(node)) return false;
  if (node.nodeName === "#text" && "value" in node && node.value.trim() && !zeroFont(node)) return true;
  if ("tagName" in node && node.tagName === "img" && attr(node, "alt")?.trim()) return true;
  return "childNodes" in node && node.childNodes.some(child => hasLabel(child, visible));
}
function unsubscribeAnchor(elements: Element[]) {
  const visible = new Set(elements);
  return elements.some(node => node.tagName === "a" && MARKER.test(attr(node, "href") ?? "") && hasLabel(node, visible));
}
export function hasCampaignUnsubscribe(html: string): boolean {
  return unsubscribeAnchor(visibleElements(html));
}

/** Add the campaign footer to the composition only. The source template stays
 * usable for individual messages and recurring service emails. Preserve source
 * spans, including Outlook conditionals, rather than serializing a parsed DOM. */
export function withCampaignUnsubscribe(html: string, text: string): { html: string; text: string } {
  const elements = visibleElements(html);
  if (!unsubscribeAnchor(elements)) {
    // Prefer the existing contact/footer cell so its authored palette is
    // inherited. Otherwise use the body, without nesting under a link or row.
    const contact = elements.findLast(node => node.tagName === "a" && /^mailto:/i.test(attr(node, "href") ?? ""));
    let container: Element | undefined;
    let current: Node | null | undefined = contact;
    while (current && "parentNode" in current) {
      current = current.parentNode;
      if (current && "tagName" in current && ["td", "th", "footer"].includes(current.tagName)
        && current.sourceCodeLocation?.endTag) { container = current; break; }
    }
    container ??= elements.findLast(node => node.tagName === "footer" && node.sourceCodeLocation?.endTag);
    container ??= elements.find(node => node.tagName === "body" && node.sourceCodeLocation?.endTag);
    const footer = '<table data-ruined-campaign-footer="true" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tbody><tr>'
      + '<td style="padding:20px 0 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;line-height:18px">'
      + `<a href="${UNSUBSCRIBE}" style="color:inherit;text-decoration:underline">Unsubscribe</a></td></tr></tbody></table>`;
    const offset = container?.sourceCodeLocation?.endTag?.startOffset
      ?? elements.find(node => node.tagName === "html")?.sourceCodeLocation?.endTag?.startOffset ?? html.length;
    html = html.slice(0, offset) + footer + html.slice(offset);
  }
  if (!/\{\{\{\s*RESEND_UNSUBSCRIBE_URL\s*\}\}\}/.test(text)) text += `\n\nUnsubscribe: ${UNSUBSCRIBE}`;
  return { html, text };
}
