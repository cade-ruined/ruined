import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { expectedShipDateReplacements } from "./product-copy.js";

export type ProductDescriptionTag =
  | "p"
  | "div"
  | "br"
  | "ul"
  | "ol"
  | "li"
  | "strong"
  | "em"
  | "h2"
  | "h3"
  | "blockquote"
  | "a"
  | "sup"
  | "sub";

export type SafeProductDescriptionNode =
  | { type: "text"; value: string }
  | {
      type: "element";
      tag: ProductDescriptionTag;
      href?: string;
      children: SafeProductDescriptionNode[];
    };

const ALLOWED_TAGS = new Set<ProductDescriptionTag>([
  "p",
  "div",
  "br",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "h2",
  "h3",
  "blockquote",
  "a",
  "sup",
  "sub",
]);

const BLOCK_WRAPPERS = new Set(["section", "article"]);
const TEXT_BLOCKS = new Set<ProductDescriptionTag>([
  "p",
  "div",
  "li",
  "h2",
  "h3",
  "blockquote",
]);

const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "template",
]);

function safeHref(value: string | undefined): string | undefined {
  const href = value?.trim();
  if (!href) return undefined;
  const schemeProbe = href.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  if (schemeProbe.startsWith("//")) return undefined;
  if (/^(?:https?:|mailto:)/i.test(schemeProbe)) return schemeProbe;
  if (/^[a-z][a-z\d+.-]*:/i.test(schemeProbe)) return undefined;
  return href;
}

function canonicalTag(tag: string): ProductDescriptionTag | undefined {
  const normalized = tag === "b" ? "strong" : tag === "i" ? "em" : tag;
  return ALLOWED_TAGS.has(normalized as ProductDescriptionTag)
    ? (normalized as ProductDescriptionTag)
    : undefined;
}

function convertNode(
  node: DefaultTreeAdapterTypes.ChildNode,
): SafeProductDescriptionNode[] {
  if (node.nodeName === "#text" && "value" in node) {
    return [{
      type: "text",
      value: node.value,
    }];
  }

  if (!("tagName" in node)) return [];
  const sourceTag = node.tagName.toLowerCase();
  if (DROP_WITH_CONTENT.has(sourceTag)) return [];

  const children = node.childNodes.flatMap((child) => convertNode(child));
  const tag = canonicalTag(sourceTag) ??
    (BLOCK_WRAPPERS.has(sourceTag) ? "div" : undefined);
  if (!tag) return children;

  if (tag === "a") {
    const href = safeHref(node.attrs.find((attribute) => attribute.name === "href")?.value);
    return href ? [{ type: "element", tag, href, children }] : children;
  }

  return [{ type: "element", tag, children }];
}

type SafeTextNode = Extract<SafeProductDescriptionNode, { type: "text" }>;
type TextLeaf = {
  node: SafeTextNode;
  original: string;
  start: number;
  end: number;
};

function containsNestedTextBlock(node: SafeProductDescriptionNode): boolean {
  if (node.type === "text") return false;
  return node.children.some((child) =>
    child.type === "element" &&
    (TEXT_BLOCKS.has(child.tag) || containsNestedTextBlock(child))
  );
}

function collectTextLeaves(
  nodes: SafeProductDescriptionNode[],
  leaves: TextLeaf[],
  offset: { value: number }
) {
  for (const node of nodes) {
    if (node.type === "text") {
      const start = offset.value;
      offset.value += node.value.length;
      leaves.push({ node, original: node.value, start, end: offset.value });
      continue;
    }
    collectTextLeaves(node.children, leaves, offset);
  }
}

function normalizeTextSequence(
  nodes: SafeProductDescriptionNode[],
  expectedShipDate?: string
) {
  const leaves: TextLeaf[] = [];
  collectTextLeaves(nodes, leaves, { value: 0 });
  const copy = leaves.map((leaf) => leaf.original).join("");
  const replacements = expectedShipDateReplacements(copy, expectedShipDate);
  if (!replacements.length) return;

  const edits = new Map<SafeTextNode, {
    start: number;
    end: number;
    value: string;
  }[]>();

  for (const replacement of replacements) {
    const startLeaf = leaves.find(
      (leaf) => leaf.start <= replacement.start && leaf.end > replacement.start
    );
    if (!startLeaf) continue;

    for (const leaf of leaves) {
      if (leaf.start >= replacement.end || leaf.end <= replacement.start) continue;
      const leafEdits = edits.get(leaf.node) ?? [];
      leafEdits.push({
        start: Math.max(0, replacement.start - leaf.start),
        end: Math.min(leaf.original.length, replacement.end - leaf.start),
        value: leaf === startLeaf ? replacement.value : "",
      });
      edits.set(leaf.node, leafEdits);
    }
  }

  for (const leaf of leaves) {
    const leafEdits = edits.get(leaf.node);
    if (!leafEdits?.length) continue;
    leaf.node.value = leafEdits
      .sort((a, b) => b.start - a.start)
      .reduce(
        (value, edit) =>
          `${value.slice(0, edit.start)}${edit.value}${value.slice(edit.end)}`,
        leaf.original
      );
  }
}

function normalizeStructuredCopy(
  nodes: SafeProductDescriptionNode[],
  expectedShipDate?: string
) {
  for (const node of nodes) {
    if (node.type === "text") continue;
    normalizeStructuredCopy(node.children, expectedShipDate);
    if (TEXT_BLOCKS.has(node.tag) && !containsNestedTextBlock(node)) {
      normalizeTextSequence(node.children, expectedShipDate);
    }
  }
}

export function parseShopifyProductDescription(
  html: string,
  expectedShipDate?: string
): SafeProductDescriptionNode[] {
  if (!html.trim()) return [];
  const fragment = parseFragment(html);
  const nodes = fragment.childNodes
    .flatMap((node) => convertNode(node))
    .filter((node) => node.type !== "text" || /\S/.test(node.value));
  normalizeStructuredCopy(nodes, expectedShipDate);
  return nodes;
}
