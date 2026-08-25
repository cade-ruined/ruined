import "server-only";

import { createElement, Fragment, type ReactNode } from "react";
import {
  parseShopifyProductDescription,
  type ProductDescriptionTag,
  type SafeProductDescriptionNode,
} from "@/lib/store/shopify-description";
import { normalizeExpectedShipDateLanguage } from "@/lib/store/product-copy.js";

const ELEMENT_CLASSES: Partial<Record<ProductDescriptionTag, string>> = {
  p: "mt-5 first:mt-0",
  div: "mt-5 first:mt-0",
  ul: "mt-5 list-disc space-y-2 pl-5",
  ol: "mt-5 list-decimal space-y-2 pl-5",
  li: "pl-1",
  strong: "font-semibold text-white",
  em: "italic",
  h2: "display mt-9 text-3xl leading-none text-white first:mt-0",
  h3: "mt-7 font-mono text-xs uppercase tracking-[0.18em] text-white first:mt-0",
  blockquote: "mt-6 border-l border-[var(--color-poster)] pl-4 text-white/80",
  a: "underline decoration-white/30 underline-offset-4 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
};

function renderNode(node: SafeProductDescriptionNode, key: string): ReactNode {
  if (node.type === "text") return node.value;

  const children = node.children.map((child, index) =>
    renderNode(child, `${key}-${index}`)
  );
  const props = {
    key,
    ...(ELEMENT_CLASSES[node.tag] ? { className: ELEMENT_CLASSES[node.tag] } : {}),
    ...(node.tag === "a" ? { href: node.href } : {}),
  };
  return createElement(node.tag, props, ...children);
}

function plainParagraphs(copy: string, expectedShipDate?: string): ReactNode[] {
  return normalizeExpectedShipDateLanguage(copy, expectedShipDate)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph, index) => (
      <p key={index} className="mt-5 whitespace-pre-line first:mt-0">
        {paragraph}
      </p>
    ));
}

export default function ProductDescription({
  description,
  descriptionHtml,
  expectedShipDate,
}: {
  description: string;
  descriptionHtml?: string;
  expectedShipDate?: string;
}) {
  const richNodes = descriptionHtml
    ? parseShopifyProductDescription(descriptionHtml, expectedShipDate)
    : [];
  const content = richNodes.length
    ? richNodes.map((node, index) => renderNode(node, `description-${index}`))
    : plainParagraphs(description, expectedShipDate);

  if (!content.length) return null;

  return (
    <div className="mt-10 max-w-prose border-t border-white/15 pt-7 text-base leading-relaxed text-white/70">
      {content.length === 1 ? content[0] : <Fragment>{content}</Fragment>}
    </div>
  );
}
