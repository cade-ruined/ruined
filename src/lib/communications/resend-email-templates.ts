import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { AdminEmailError } from "./admin-email-model";
import type {
  RenderedResendEmail, ResendEmailBanner, ResendEmailEdits, ResendEmailSignOff, ResendEmailSignOffImage,
  ResendEmailTemplate, ResendEmailTemplateField, ResendEmailTemplateVariable,
} from "./resend-email-model";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type SourceSpan = { start: number; end: number };
type TextField = ResendEmailTemplateField & SourceSpan;
type Token = SourceSpan & { key: string; literal: string };
type Placement = SourceSpan & { kind: "text" | "attribute"; attribute?: string; element?: Element };
type Replacement = SourceSpan & { value: string };
const BLOCKED_COPY_TAGS = new Set(["head", "script", "style", "title", "textarea", "iframe", "object", "embed", "svg", "math", "template", "noscript"]);
const BLOCKED_VARIABLE_TAGS = new Set(["script", "style", "textarea", "iframe", "object", "embed", "svg", "math", "template", "noscript"]);
const TEXT_ATTRIBUTES = new Set(["alt", "title", "aria-label"]);
const URL_ATTRIBUTES = new Set(["href", "src", "background"]);
const BLOCK_TAGS = new Set(["p", "div", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "li", "blockquote"]);
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/;
const MAX_HTML_LENGTH = 1_000_000;
const MAX_FIELD_LENGTH = 12_000;
const BANNER_CONTAINERS = new Set(["body", "div", "section", "article", "main", "header", "footer", "aside", "td", "th", "center", "blockquote", "li"]);
const TYPOGRAPHY_TAGS = new Set(["body", "div", "section", "article", "main", "header", "footer", "aside", "td", "th", "center", "blockquote", "li", "ul", "ol", "p", "a", "span", "strong", "b", "em", "i", "u", "s", "small", "sup", "sub", "h1", "h2", "h3", "h4", "h5", "h6"]);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isElement = (node: Node): node is Element => "tagName" in node;
const isText = (node: Node): node is DefaultTreeAdapterTypes.TextNode => node.nodeName === "#text";
const nativeKey = (key: string) => key === "RESEND_UNSUBSCRIBE_URL" || /^contact\.[A-Za-z_][A-Za-z0-9_]*(?:\|[^{}\r\n]*)?$/.test(key);
const escapedText = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
// Whitespace, ` and = also need encoding in unquoted attributes. Escaping only
// quotes is insufficient for a source template such as href={{{LINK}}}.
const escapedAttribute = (value: string) => escapedText(value).replace(/[\u0009-\u0020=`]/g, char => `&#${char.charCodeAt(0)};`);

function tokens(source: string): Token[] {
  const found = [...source.matchAll(/\{\{\{([^{}]+?)\}\}\}/g)].map(match => ({
    key: match[1].trim(), literal: match[0], start: match.index, end: match.index + match[0].length,
  }));
  if (found.some(token => !KEY_PATTERN.test(token.key) && !nativeKey(token.key))) throw new AdminEmailError(400, "This design contains an unsupported template placeholder. Update it in Resend first.");
  let remaining = source;
  for (const token of [...found].reverse()) remaining = remaining.slice(0, token.start) + remaining.slice(token.end);
  if (remaining.includes("{{")) throw new AdminEmailError(400, "This design contains an unsupported or incomplete template placeholder. Update it in Resend first.");
  return found;
}
function hidden(element: Element) {
  return element.attrs.some(attribute => attribute.name === "hidden"
    || (attribute.name === "aria-hidden" && attribute.value.toLowerCase() === "true")
    || (attribute.name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)(?:\s*!important)?\s*(?:;|$)/i.test(attribute.value)));
}

function bannerUrl(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 2_048 || /[\u0000-\u0020\u007f-\u009f<>"\\]/.test(value)
    || /\{\{|\}\}|%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value) || !/^https:\/\//i.test(value)) {
    throw new AdminEmailError(400, `${label} must be a public HTTPS URL of 2,048 characters or fewer.`);
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new AdminEmailError(400, `${label} must be a valid public HTTPS URL.`); }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  // Use public DNS names only. No server-side fetching or DNS lookup is needed
  // to render a banner; IP literals and local-only names are not image hosts.
  if (url.protocol !== "https:" || url.username || url.password || !hostname.includes(".") || hostname.includes(":")
    || /^[\d.]+$/.test(hostname) || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/.test(hostname)
    || hostname.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new AdminEmailError(400, `${label} must use a public HTTPS domain without credentials or a local address.`);
  }
  return value;
}

export function normalizeResendEmailBanner(value: unknown): ResendEmailBanner | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || Object.keys(value).some(key => !["url", "alt", "linkUrl"].includes(key))) throw new AdminEmailError(400, "Add a banner image URL and alternative text.");
  const url = bannerUrl(value.url, "The banner image address");
  if (typeof value.alt !== "string" || !value.alt.trim() || value.alt.length > 300 || /[\u0000-\u001f\u007f-\u009f]|\{\{|\}\}/.test(value.alt)) {
    throw new AdminEmailError(400, "Add banner alternative text of 300 characters or fewer, on one line and without placeholders.");
  }
  const linkUrl = value.linkUrl === undefined || value.linkUrl === "" ? undefined : bannerUrl(value.linkUrl, "The banner destination");
  return { url, alt: value.alt.trim(), ...(linkUrl ? { linkUrl } : {}) };
}

export function normalizeResendEmailSignOff(value: unknown): ResendEmailSignOff | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || Object.keys(value).some(key => key !== "text") || typeof value.text !== "string"
    || !value.text.trim() || Array.from(value.text.trim()).length > 80
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]|\{\{|\}\}/.test(value.text)) {
    throw new AdminEmailError(400, "Add a sign-off of 80 characters or fewer, on one line and without placeholders.");
  }
  return { text: value.text.trim() };
}

function attribute(element: Element, name: string) { return element.attrs.find(item => item.name === name)?.value; }
function isSignOffImage(element: Element) {
  if (element.tagName !== "img") return false;
  return attribute(element, "data-ruined-sign-off") !== undefined
    || /(?:^|\/)after-the-fear-cadehandy2\.png(?:[?#].*)?$/.test(attribute(element, "src") ?? "");
}
function visibleNodes(html: string) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const nodes: Node[] = [];
  function visit(node: Node) {
    if (isElement(node) && (BLOCKED_COPY_TAGS.has(node.tagName) || hidden(node))) return;
    nodes.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visit);
  }
  visit(document);
  return { document, nodes };
}
function signOffImages(nodes: Node[]) {
  return nodes.filter((node): node is Element => isElement(node) && isSignOffImage(node) && Boolean(node.sourceCodeLocation));
}
function originalSignOffText(images: Element[]) {
  const image = images.find(item => attribute(item, "data-ruined-sign-off") !== undefined) ?? images[0];
  if (!image) return undefined;
  const text = attribute(image, "alt")?.trim();
  return text || (/after-the-fear-cadehandy2\.png(?:[?#].*)?$/.test(attribute(image, "src") ?? "") ? "After the fear" : undefined);
}
function replaceSpans(html: string, replacements: Replacement[]) {
  for (const item of replacements.sort((a, b) => b.start - a.start)) html = html.slice(0, item.start) + item.value + html.slice(item.end);
  return html;
}
function attributeReplacements(element: Element, changes: Record<string, string>): Replacement[] {
  const tag = element.sourceCodeLocation?.startTag;
  if (!tag) return [];
  const replacements: Replacement[] = [];
  let added = "";
  for (const [name, value] of Object.entries(changes)) {
    const rendered = `${name}="${escapedText(value)}"`;
    const location = element.sourceCodeLocation?.attrs?.[name];
    if (location) replacements.push({ start: location.startOffset, end: location.endOffset, value: rendered });
    else added += ` ${rendered}`;
  }
  // Insert just after the tag name, which also works for XHTML self-closing tags.
  if (added) replacements.push({ start: tag.startOffset + element.tagName.length + 1, end: tag.startOffset + element.tagName.length + 1, value: added });
  return replacements;
}
function appendedStyle(element: Element, declarations: string) {
  const existing = attribute(element, "style") ?? "";
  return `${existing}${existing && !existing.trimEnd().endsWith(";") ? ";" : ""}${declarations}`;
}

/** Only generated assets supplied by the server may contain preview data URLs. */
function validatedSignOffImage(image: ResendEmailSignOffImage | undefined): ResendEmailSignOffImage {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)
    || image.width < 1 || image.height < 1 || image.width > 1600 || image.height > 1600 || typeof image.url !== "string") {
    throw new AdminEmailError(400, "Prepare the sign-off artwork before reviewing this email.");
  }
  if (image.url.startsWith("data:")) {
    if (image.url.length > 4_194_326 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*(?:={1,2})?$/.test(image.url)
      || (image.url.length - "data:image/png;base64,".length) % 4 !== 0) {
      throw new AdminEmailError(400, "The sign-off preview must be a generated PNG image.");
    }
  } else bannerUrl(image.url, "The sign-off image address");
  return image;
}
function blockBeside(node: Node, after = false) {
  let current = node;
  while ("parentNode" in current && current.parentNode) {
    const parent = current.parentNode;
    if (isElement(parent) && BANNER_CONTAINERS.has(parent.tagName) && current.sourceCodeLocation) {
      return { offset: after ? current.sourceCodeLocation.endOffset : current.sourceCodeLocation.startOffset, container: parent, node: current };
    }
    current = parent;
  }
  return null;
}
function signOffPlacement(html: string, nodes: Node[]) {
  const unsubscribe = nodes.find(node => isElement(node) && node.tagName === "a" && /\{\{\{\s*RESEND_UNSUBSCRIBE_URL\s*\}\}\}/.test(attribute(node, "href") ?? ""));
  const mail = nodes.findLast(node => isElement(node) && node.tagName === "a" && /^mailto:/i.test(attribute(node, "href") ?? ""));
  let footer = nodes.find(node => isElement(node) && node.tagName === "footer");
  for (const target of [unsubscribe, mail]) {
    let current = target;
    while (!footer && current) {
      if (isElement(current) && /(?:^|;)\s*border-top(?:-[a-z]+)?\s*:/i.test(attribute(current, "style") ?? "")) { footer = current; break; }
      current = "parentNode" in current ? current.parentNode ?? undefined : undefined;
    }
  }
  footer ??= unsubscribe ? blockBeside(unsubscribe)?.node : undefined;
  if (footer?.sourceCodeLocation) {
    const before = footer.sourceCodeLocation.startOffset;
    const precedingCopy = nodes.findLast(node => isText(node) && /[\p{L}\p{N}]/u.test(node.value)
      && (node.sourceCodeLocation?.endOffset ?? Infinity) <= before);
    const precedingImage = nodes.findLast(node => isElement(node) && node.tagName === "img"
      && (node.sourceCodeLocation?.endOffset ?? Infinity) <= before);
    // A footer may be a separate table row. Stay in the previous content cell,
    // never insert a table between its tr and td or inside the footer itself.
    for (const target of [precedingCopy, precedingImage]) if (target) {
      const placement = blockBeside(target, true);
      if (placement && placement.offset <= before) return placement;
    }
    const placement = blockBeside(footer);
    if (placement) return placement;
  }
  const lastCopy = nodes.findLast(node => isText(node) && /[\p{L}\p{N}]/u.test(node.value));
  const lastImage = nodes.findLast(node => isElement(node) && node.tagName === "img");
  for (const target of [lastCopy, lastImage]) if (target) {
    const placement = blockBeside(target, true);
    if (placement) return placement;
  }
  return bannerPlacement(html);
}
function applySignOff(html: string, signOff: ResendEmailSignOff | null, image?: ResendEmailSignOffImage) {
  const { nodes } = visibleNodes(html);
  const existing = signOffImages(nodes);
  if (!signOff) return replaceSpans(html, existing.map(item => ({ start: item.sourceCodeLocation!.startOffset, end: item.sourceCodeLocation!.endOffset, value: "" })));
  const asset = validatedSignOffImage(image);
  const style = `width:${asset.width}px!important;max-width:100%!important;height:auto!important;border:0;color:#ffca2c;`;
  if (existing.length) {
    return replaceSpans(html, existing.flatMap(item => attributeReplacements(item, {
      src: asset.url, alt: signOff.text, width: String(asset.width), height: String(asset.height),
      "data-ruined-sign-off": "", style: appendedStyle(item, style),
    })));
  }
  const { offset } = signOffPlacement(html, nodes);
  const markup = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tbody><tr><td style="padding:16px 0 8px"><img data-ruined-sign-off="" src="${escapedText(asset.url)}" alt="${escapedText(signOff.text)}" width="${asset.width}" height="${asset.height}" style="display:block;${style}"></td></tr></tbody></table>`;
  return html.slice(0, offset) + markup + html.slice(offset);
}

function applyRuinedTypography(html: string) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const replacements: Replacement[] = [];
  let head: Element | undefined;
  function visit(node: Node, heading = false) {
    if (isElement(node)) {
      if (node.tagName === "head") { head = node; return; }
      if (BLOCKED_COPY_TAGS.has(node.tagName) || hidden(node)) return;
      heading ||= /^h[1-6]$/.test(node.tagName);
      if (TYPOGRAPHY_TAGS.has(node.tagName)) {
        const family = heading ? "'IvyOraRuined',Georgia,'Times New Roman',serif" : "'InterRuined',Inter,'Helvetica Neue',Helvetica,Arial,sans-serif";
        const fallback = heading ? "Georgia" : "Arial";
        const declarations = `font-family:${family}!important;${heading ? "font-weight:500!important;letter-spacing:normal!important;" : ""}mso-ascii-font-family:${fallback};mso-hansi-font-family:${fallback};mso-bidi-font-family:${fallback};`;
        replacements.push(...attributeReplacements(node, { style: appendedStyle(node, declarations) }));
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child, heading);
  }
  visit(document);
  const fonts = "<!--[if !mso]><!--><style data-ruined-email-fonts>"
    + "@font-face{font-family:'IvyOraRuined';font-style:normal;font-weight:500;src:url('https://members.theruinedproject.com/fonts/IvyOraText-Medium.ttf') format('truetype');mso-font-alt:Georgia;}"
    + "@font-face{font-family:'InterRuined';font-style:normal;font-weight:100 900;src:url('https://members.theruinedproject.com/fonts/Inter-Variable-Latin.woff2') format('woff2');mso-font-alt:Arial;}"
    + "</style><!--<![endif]-->";
  const offset = head?.sourceCodeLocation?.endTag?.startOffset ?? head?.sourceCodeLocation?.startTag?.endOffset;
  if (offset !== undefined) replacements.push({ start: offset, end: offset, value: fonts });
  const rendered = replaceSpans(html, replacements);
  return offset === undefined ? fonts + rendered : rendered;
}

function bannerPlacement(html: string) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const visible: Node[] = [];
  function visit(node: Node) {
    if (isElement(node) && (BLOCKED_COPY_TAGS.has(node.tagName) || hidden(node))) return;
    visible.push(node);
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  }
  visit(document);
  const visibleSet = new Set(visible);
  function hasCopy(node: Node): boolean {
    if (!visibleSet.has(node)) return false;
    return isText(node) ? /[\p{L}\p{N}]/u.test(node.value) : "childNodes" in node && node.childNodes.some(hasCopy);
  }
  function beside(node: Node, after = false) {
    let current = node;
    while ("parentNode" in current && current.parentNode) {
      const parent = current.parentNode;
      if (isElement(parent) && BANNER_CONTAINERS.has(parent.tagName) && current.sourceCodeLocation) {
        return { offset: after ? current.sourceCodeLocation.endOffset : current.sourceCodeLocation.startOffset, container: parent };
      }
      current = parent;
    }
    return null;
  }
  const heading = visible.find(node => isElement(node) && node.tagName === "h1" && hasCopy(node));
  if (heading) {
    const placement = beside(heading);
    if (placement) return placement;
  }
  // Logo-only paragraphs and tables have no copy, so a heading-free design
  // still keeps its existing wordmark above the optional image.
  const firstCopy = visible.find(node => isText(node) && hasCopy(node));
  if (firstCopy) {
    const placement = beside(firstCopy);
    if (placement) return placement;
  }
  const firstImage = visible.find(node => isElement(node) && node.tagName === "img");
  if (firstImage) {
    const placement = beside(firstImage, true);
    if (placement) return placement;
  }
  const cell = visible.find((node): node is Element => isElement(node) && ["td", "th"].includes(node.tagName) && Boolean(node.sourceCodeLocation?.startTag));
  if (cell) return { offset: cell.sourceCodeLocation!.startTag!.endOffset, container: cell };
  const body = visible.find((node): node is Element => isElement(node) && node.tagName === "body")!;
  const htmlElement = visible.find((node): node is Element => isElement(node) && node.tagName === "html");
  return { offset: body.sourceCodeLocation?.startTag?.endOffset
    ?? body.childNodes.find(node => node.sourceCodeLocation)?.sourceCodeLocation?.startOffset
    ?? htmlElement?.sourceCodeLocation?.endTag?.startOffset ?? html.length, container: body };
}

function bannerWidth(container: Element) {
  let horizontalPadding = 0;
  let current: Node | null = container;
  while (current && isElement(current)) {
    const style = current.attrs.find(attribute => attribute.name === "style")?.value ?? "";
    const declarations = new Map(style.split(";").flatMap(declaration => {
      const index = declaration.indexOf(":");
      return index < 0 ? [] : [[declaration.slice(0, index).trim().toLowerCase(), declaration.slice(index + 1).trim()]];
    }));
    const pixels = (value: string | undefined) => value && /^(?:\d+(?:\.\d+)?)(?:px)?(?:\s*!important)?$/i.test(value) ? Number.parseFloat(value) : 0;
    const padding = (declarations.get("padding") ?? "").split(/\s+/).map(pixels);
    const left = declarations.has("padding-left") ? pixels(declarations.get("padding-left")) : padding.length === 4 ? padding[3] : padding.length > 1 ? padding[1] : padding[0];
    const right = declarations.has("padding-right") ? pixels(declarations.get("padding-right")) : padding.length > 1 ? padding[1] : padding[0];
    horizontalPadding += (left || 0) + (right || 0);
    const widths = [pixels(declarations.get("max-width")), pixels(declarations.get("width")),
      pixels(current.attrs.find(attribute => attribute.name === "width")?.value)].filter(width => width > 0);
    if (widths.length) return Math.max(1, Math.round(Math.min(...widths) - horizontalPadding));
    current = "parentNode" in current ? current.parentNode : null;
  }
  return Math.max(1, 600 - horizontalPadding);
}

/** Add a per-message banner using one insertion; never serialize the design. */
export function insertResendEmailBanner(html: string, value: ResendEmailBanner): string {
  const banner = normalizeResendEmailBanner(value)!;
  const { offset, container } = bannerPlacement(html);
  const width = bannerWidth(container);
  const image = `<img src="${escapedText(banner.url)}" alt="${escapedText(banner.alt)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0">`;
  const linked = banner.linkUrl ? `<a href="${escapedText(banner.linkUrl)}" style="text-decoration:none">${image}</a>` : image;
  const markup = `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:${width}px;border-collapse:collapse"><tbody><tr><td style="padding:0 0 24px">${linked}</td></tr></tbody></table>`;
  return html.slice(0, offset) + markup + html.slice(offset);
}
function inspectHtml(html: string) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const fields: TextField[] = [];
  const placements: Placement[] = [];
  function visit(node: Node, copyBlocked = false, variableBlocked = false) {
    const element = isElement(node) ? node : null;
    const unsubscribeLink = Boolean(element?.tagName === "a" && element.attrs.some(attribute => attribute.name === "href"
      && /\{\{\{\s*RESEND_UNSUBSCRIBE_URL\s*\}\}\}/.test(attribute.value)));
    const copyExcluded = copyBlocked || Boolean(element && (BLOCKED_COPY_TAGS.has(element.tagName) || hidden(element))) || unsubscribeLink;
    const variableExcluded = variableBlocked || Boolean(element && BLOCKED_VARIABLE_TAGS.has(element.tagName));
    const location = node.sourceCodeLocation;
    if (isText(node) && location) {
      if (!variableExcluded) placements.push({ kind: "text", start: location.startOffset, end: location.endOffset });
      // Expose static copy separately from named variables. Editing surrounding
      // structure or deleting provider personalization is not a text edit.
      if (!copyExcluded && /[\p{L}\p{N}]/u.test(node.value) && !node.value.includes("{{")) {
        const raw = html.slice(location.startOffset, location.endOffset);
        const before = raw.match(/^[\t\n\r ]*/)?.[0].length ?? 0;
        const after = raw.match(/[\t\n\r ]*$/)?.[0].length ?? 0;
        const value = node.value.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
        const start = location.startOffset + before;
        const end = location.endOffset - after;
        if (start < end) fields.push({ key: `text:${start}:${end}`, label: value.replace(/\s+/g, " ").slice(0, 90), value, start, end });
      }
    }
    if (element && !variableExcluded) for (const attribute of element.attrs) {
      const attributeLocation = element.sourceCodeLocation?.attrs?.[attribute.name];
      if (attributeLocation && (TEXT_ATTRIBUTES.has(attribute.name) || URL_ATTRIBUTES.has(attribute.name))) {
        placements.push({ kind: "attribute", attribute: attribute.name, element,
          start: attributeLocation.startOffset, end: attributeLocation.endOffset });
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child, copyExcluded, variableExcluded);
  }
  visit(document);
  return { document, fields, placements };
}

/** Normalize only authoritative provider responses. Browser input never supplies HTML. */
export function normalizeResendTemplate(provider: unknown): ResendEmailTemplate {
  if (!isRecord(provider) || typeof provider.id !== "string" || !provider.id || typeof provider.name !== "string"
    || typeof provider.html !== "string" || !provider.html.trim() || provider.html.length > MAX_HTML_LENGTH
    || !["draft", "published"].includes(String(provider.status)) || typeof provider.current_version_id !== "string" || !provider.current_version_id) {
    throw new AdminEmailError(502, "Resend returned an incomplete email design. Refresh the template in Resend.");
  }
  if (provider.variables !== null && provider.variables !== undefined && !Array.isArray(provider.variables)) throw new AdminEmailError(502, "Resend returned invalid template variables.");
  const variables: ResendEmailTemplateVariable[] = [];
  const keys = new Set<string>();
  for (const variable of provider.variables ?? []) {
    if (!isRecord(variable) || typeof variable.key !== "string" || !KEY_PATTERN.test(variable.key) || keys.has(variable.key)
      || !["string", "number"].includes(String(variable.type))) throw new AdminEmailError(502, "Resend returned invalid template variables.");
    const fallback = variable.fallback_value ?? null;
    if (fallback !== null && (typeof fallback !== variable.type || (typeof fallback === "number" && !Number.isFinite(fallback)))) throw new AdminEmailError(502, "Resend returned an invalid template fallback.");
    variables.push({ key: variable.key, type: variable.type as "string" | "number", fallbackValue: fallback as string | number | null });
    keys.add(variable.key);
  }
  const html = provider.html;
  const subject = typeof provider.subject === "string" ? provider.subject : "";
  const text = typeof provider.text === "string" ? provider.text : null;
  const fields = inspectHtml(html).fields.map(({ key, label, value }) => ({ key, label, value }));
  const signOffText = originalSignOffText(signOffImages(visibleNodes(html).nodes));
  return {
    id: provider.id, name: provider.name, status: provider.status as "draft" | "published", version: provider.current_version_id,
    html, text, subject,
    from: typeof provider.from === "string" ? provider.from : "",
    replyTo: Array.isArray(provider.reply_to) && provider.reply_to.every(value => typeof value === "string") ? provider.reply_to as string[] : [],
    variables, fields, hasUnpublishedVersions: provider.has_unpublished_versions === true,
    campaignOnly: [html, subject, text ?? ""].some(source => tokens(source).some(token => nativeKey(token.key))),
    ...(signOffText === undefined ? {} : { signOffText }),
  };
}

function stringRecord(value: unknown, label: string, maximum = MAX_FIELD_LENGTH): Record<string, string> {
  if (!isRecord(value) || Object.values(value).some(item => typeof item !== "string" || item.length > maximum || /\u0000/.test(item))) {
    throw new AdminEmailError(400, `${label} must contain text values of ${maximum.toLocaleString("en-US")} characters or fewer.`);
  }
  return value as Record<string, string>;
}
function variableValues(template: ResendEmailTemplate, supplied: Record<string, string>) {
  const definitions = new Map(template.variables.map(variable => [variable.key, variable]));
  for (const key of Object.keys(supplied)) if (!definitions.has(key) || nativeKey(key)) throw new AdminEmailError(400, `The design does not have an editable variable named ${key}.`);
  const values = new Map<string, string>();
  for (const variable of template.variables) {
    if (nativeKey(variable.key)) continue;
    const provided = Object.hasOwn(supplied, variable.key) ? supplied[variable.key] : "";
    const raw = provided.trim() ? provided : variable.fallbackValue === null ? null : String(variable.fallbackValue);
    if (raw === null) continue;
    if (raw.includes("{{")) throw new AdminEmailError(400, "Variable values must be plain text, without additional template placeholders.");
    if (variable.type === "number") {
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim()) || !Number.isFinite(Number(raw))) throw new AdminEmailError(400, `${variable.key} must be a valid number.`);
      values.set(variable.key, String(Number(raw)));
    } else values.set(variable.key, raw);
  }
  return values;
}
function assertUrlAttribute(element: Element, name: string, resolve: (key: string, literal: string) => string) {
  const original = element.attrs.find(attribute => attribute.name === name)?.value ?? "";
  const found = tokens(original);
  if (!found.length || found.every(token => nativeKey(token.key))) return;
  let result = original;
  for (const token of [...found].reverse()) {
    const replacement = nativeKey(token.key) ? (token.key === "RESEND_UNSUBSCRIBE_URL" ? "https://resend.invalid/unsubscribe" : "value") : resolve(token.key, token.literal);
    result = result.slice(0, token.start) + replacement + result.slice(token.end);
  }
  if (/[\u0000-\u0020\u007f-\u009f]/.test(result)) throw new AdminEmailError(400, "A link or image variable contains invalid whitespace.");
  let url: URL;
  try { url = new URL(result); } catch { throw new AdminEmailError(400, "Link and image variables must form absolute URLs."); }
  const allowed = name === "href" ? ["https:", "http:", "mailto:", "tel:"] : ["https:", "http:", "cid:"];
  if (!allowed.includes(url.protocol) || url.username || url.password) throw new AdminEmailError(400, "A link or image variable uses an unsupported URL.");
}

function plainTextFromHtml(html: string, includeSignOff = false): string {
  const document = parse(html);
  const parts: string[] = [];
  function visit(node: Node) {
    if (isElement(node)) {
      if (BLOCKED_COPY_TAGS.has(node.tagName) || hidden(node)) return;
      if (node.tagName === "br") parts.push("\n");
      if (includeSignOff && isSignOffImage(node)) parts.push(`\n\n${attribute(node, "alt") ?? ""}\n\n`);
      if (BLOCK_TAGS.has(node.tagName)) parts.push("\n\n");
      for (const child of node.childNodes) visit(child);
      if (node.tagName === "a") {
        const href = node.attrs.find(attribute => attribute.name === "href")?.value;
        if (href) parts.push(` (${href})`);
      }
      if (BLOCK_TAGS.has(node.tagName)) parts.push("\n\n");
    } else if (isText(node)) parts.push(node.value.replace(/[\t\r\n ]+/g, " "));
    else if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  }
  visit(document);
  return parts.join("").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function updateAuthoredSignOff(text: string, previous: string | undefined, next: string | undefined) {
  const lines = text.split(/\r?\n/);
  const previousIndex = previous ? lines.findLastIndex(line => line.trim() === previous) : -1;
  const nextIndex = next ? lines.findLastIndex(line => line.trim() === next) : -1;
  if (previousIndex >= 0) {
    if (nextIndex >= 0 && nextIndex !== previousIndex) lines.splice(previousIndex, 1);
    else lines.splice(previousIndex, 1, ...(next ? [next] : []));
    return lines.join("\n");
  }
  if (!next || nextIndex >= 0) return text;
  const unsubscribeIndex = lines.findIndex(line => line.includes("RESEND_UNSUBSCRIBE_URL"));
  if (unsubscribeIndex >= 0) lines.splice(unsubscribeIndex, 0, next, "");
  else lines.push("", next);
  return lines.join("\n");
}

/** Render a reviewed provider design without rebuilding its DOM. Untouched
 * bytes, assets, links, conditional comments and inline styling stay intact. */
export function renderResendEmailTemplate(template: ResendEmailTemplate, edits: ResendEmailEdits, options: { campaign: boolean; signOffImage?: ResendEmailSignOffImage }): RenderedResendEmail {
  if (!edits || typeof edits.subject !== "string" || !edits.subject.trim() || edits.subject.length > 200
    || /[\u0000-\u001f\u007f]/.test(edits.subject)) throw new AdminEmailError(400, "Add a subject of 200 characters or fewer, on one line.");
  const banner = normalizeResendEmailBanner(edits.banner);
  const signOff = normalizeResendEmailSignOff(edits.signOff);
  if (edits.typography !== undefined && edits.typography !== "ruined") throw new AdminEmailError(400, "Choose the Ruined email typography.");
  const supplied = stringRecord(edits.values, "Template variables", 6_000);
  const copy = stringRecord(edits.copy, "Design copy");
  if ([...Object.values(supplied), ...Object.values(copy)].reduce((total, value) => total + value.length, 0) > 48_000) throw new AdminEmailError(400, "The combined template edits must be 48,000 characters or fewer.");
  const values = variableValues(template, supplied);
  const inspected = inspectHtml(template.html);
  const fields = new Map(inspected.fields.map(field => [field.key, field]));
  for (const key of Object.keys(copy)) if (!fields.has(key)) throw new AdminEmailError(400, "The selected design changed. Reload it before editing its copy.");
  const originalNativeKeys = new Set([template.html, template.subject, template.text ?? ""].flatMap(source => tokens(source).filter(token => nativeKey(token.key)).map(token => token.key)));
  function resolve(key: string, literal: string) {
    if (nativeKey(key)) {
      if (!options.campaign || !originalNativeKeys.has(key)) throw new AdminEmailError(400, "This design uses Resend campaign personalization. Use a campaign or choose an individual-email design.");
      return literal;
    }
    const value = values.get(key);
    if (value === undefined) throw new AdminEmailError(400, `Add a value for the template variable ${key}.`);
    return value;
  }
  function renderText(source: string) {
    let result = source;
    for (const token of tokens(source).reverse()) result = result.slice(0, token.start) + resolve(token.key, token.literal) + result.slice(token.end);
    return result;
  }
  const replacements: Array<SourceSpan & { value: string }> = [];
  let copyChanged = false;
  for (const [key, value] of Object.entries(copy)) {
    const field = fields.get(key)!;
    if (value.includes("{{")) throw new AdminEmailError(400, "Design copy must be plain text, without template placeholders.");
    if (value !== field.value) {
      replacements.push({ start: field.start, end: field.end, value: escapedText(value) });
      copyChanged = true;
    }
  }
  const validatedAttributes = new Set<string>();
  for (const token of tokens(template.html)) {
    const placement = inspected.placements.find(item => token.start >= item.start && token.end <= item.end);
    if (!placement) throw new AdminEmailError(400, `The variable ${token.key} appears inside layout or active code. Update that design in Resend first.`);
    const resolved = resolve(token.key, token.literal);
    if (placement.kind === "attribute" && placement.attribute && placement.element && URL_ATTRIBUTES.has(placement.attribute)) {
      const marker = `${placement.start}:${placement.end}`;
      if (!validatedAttributes.has(marker)) assertUrlAttribute(placement.element, placement.attribute, resolve);
      validatedAttributes.add(marker);
    }
    // Preserve provider-native personalization exactly for a provider campaign.
    if (nativeKey(token.key)) continue;
    replacements.push({ start: token.start, end: token.end, value: placement.kind === "attribute" ? escapedAttribute(resolved) : escapedText(resolved) });
  }
  let html = template.html;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) html = html.slice(0, replacement.start) + replacement.value + html.slice(replacement.end);
  if (edits.signOff !== undefined) html = applySignOff(html, signOff, options.signOffImage);
  const subject = renderText(edits.subject.trim());
  if (!subject || subject.length > 200 || /[\u0000-\u001f\u007f]/.test(subject)) throw new AdminEmailError(400, "The completed subject must be one line and at most 200 characters.");
  // Preserve an authored text alternative when copy is unchanged. Regenerate
  // from the edited HTML when needed so plaintext readers receive the same copy.
  let bodyText = template.text && !copyChanged ? renderText(template.text) : plainTextFromHtml(html, edits.signOff !== undefined);
  if (template.text && !copyChanged && edits.signOff !== undefined) {
    bodyText = updateAuthoredSignOff(bodyText, originalSignOffText(signOffImages(visibleNodes(template.html).nodes)), signOff?.text);
  }
  const text = banner ? `${banner.alt}${banner.linkUrl ? `\n${banner.linkUrl}` : ""}\n\n${bodyText}` : bodyText;
  if (banner) html = insertResendEmailBanner(html, banner);
  if (edits.typography === "ruined") html = applyRuinedTypography(html);
  const from = renderText(template.from);
  const replyTo = template.replyTo.map(renderText);
  if (/[\u0000-\u001f\u007f]/.test(from) || replyTo.some(value => /[\u0000-\u001f\u007f]/.test(value))) throw new AdminEmailError(400, "The template sender or reply address contains an invalid value.");
  return { html, text, subject, from, replyTo };
}
