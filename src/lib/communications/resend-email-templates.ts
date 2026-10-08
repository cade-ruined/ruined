import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { AdminEmailError } from "./admin-email-model";
import type {
  RenderedResendEmail, ResendEmailEdits, ResendEmailTemplate, ResendEmailTemplateField, ResendEmailTemplateVariable,
} from "./resend-email-model";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type SourceSpan = { start: number; end: number };
type TextField = ResendEmailTemplateField & SourceSpan;
type Token = SourceSpan & { key: string; literal: string };
type Placement = SourceSpan & { kind: "text" | "attribute"; attribute?: string; element?: Element };
const BLOCKED_COPY_TAGS = new Set(["head", "script", "style", "title", "textarea", "iframe", "object", "embed", "svg", "math", "template", "noscript"]);
const BLOCKED_VARIABLE_TAGS = new Set(["script", "style", "textarea", "iframe", "object", "embed", "svg", "math", "template", "noscript"]);
const TEXT_ATTRIBUTES = new Set(["alt", "title", "aria-label"]);
const URL_ATTRIBUTES = new Set(["href", "src", "background"]);
const BLOCK_TAGS = new Set(["p", "div", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "li", "blockquote"]);
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/;
const MAX_HTML_LENGTH = 1_000_000;
const MAX_FIELD_LENGTH = 12_000;
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
  return {
    id: provider.id, name: provider.name, status: provider.status as "draft" | "published", version: provider.current_version_id,
    html, text, subject,
    from: typeof provider.from === "string" ? provider.from : "",
    replyTo: Array.isArray(provider.reply_to) && provider.reply_to.every(value => typeof value === "string") ? provider.reply_to as string[] : [],
    variables, fields, hasUnpublishedVersions: provider.has_unpublished_versions === true,
    campaignOnly: [html, subject, text ?? ""].some(source => tokens(source).some(token => nativeKey(token.key))),
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

function plainTextFromHtml(html: string): string {
  const document = parse(html);
  const parts: string[] = [];
  function visit(node: Node) {
    if (isElement(node)) {
      if (BLOCKED_COPY_TAGS.has(node.tagName) || hidden(node)) return;
      if (node.tagName === "br") parts.push("\n");
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

/** Render a reviewed provider design without rebuilding its DOM. Untouched
 * bytes, assets, links, conditional comments and inline styling stay intact. */
export function renderResendEmailTemplate(template: ResendEmailTemplate, edits: ResendEmailEdits, options: { campaign: boolean }): RenderedResendEmail {
  if (!edits || typeof edits.subject !== "string" || !edits.subject.trim() || edits.subject.length > 200
    || /[\u0000-\u001f\u007f]/.test(edits.subject)) throw new AdminEmailError(400, "Add a subject of 200 characters or fewer, on one line.");
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
  const subject = renderText(edits.subject.trim());
  if (!subject || subject.length > 200 || /[\u0000-\u001f\u007f]/.test(subject)) throw new AdminEmailError(400, "The completed subject must be one line and at most 200 characters.");
  // Preserve an authored text alternative when copy is unchanged. Regenerate
  // from the edited HTML when needed so plaintext readers receive the same copy.
  const text = template.text && !copyChanged ? renderText(template.text) : plainTextFromHtml(html);
  const from = renderText(template.from);
  const replyTo = template.replyTo.map(renderText);
  if (/[\u0000-\u001f\u007f]/.test(from) || replyTo.some(value => /[\u0000-\u001f\u007f]/.test(value))) throw new AdminEmailError(400, "The template sender or reply address contains an invalid value.");
  return { html, text, subject, from, replyTo };
}
