import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";

type Policy = { body: string } | null;

function policyText(html: string): string {
  function text(node: DefaultTreeAdapterTypes.Node): string {
    if ("tagName" in node && ["script", "style", "template"].includes(node.tagName)) return "";
    if ("value" in node) return node.value;
    return "childNodes" in node ? node.childNodes.map(text).join(" ") : "";
  }
  return text(parseFragment(html)).replace(/\s+/g, " ").trim();
}

/**
 * Only describe the published policy we can interpret unambiguously. If Shopify
 * changes its wording or exceptions, keep displaying it but omit inferred terms
 * until the structured policy is reviewed. Never supply default return promises.
 */
export function merchantReturnPolicy(policies: { shipping: Policy; returns: Policy }, siteUrl: string) {
  if (!policies.shipping || !policies.returns) return undefined;
  const shipping = policyText(policies.shipping.body);
  if (!shipping.startsWith("We currently ship within the United States.") || /international|outside the United States|worldwide/i.test(shipping)) return undefined;

  const returns = policyText(policies.returns.body);
  const supported = /^Return requests must be made within (\d+) days of delivery\. Items must be unworn, unwashed, unused, and returned in their original condition\. Return shipping is the customer's responsibility unless the item arrived damaged or incorrect\. Preorders follow the same return terms after delivery\. Contact us before sending anything back\.$/.exec(returns);
  const days = supported ? Number(supported[1]) : 0;
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) return undefined;

  const policyUrl = new URL("/shipping-returns", siteUrl).href;
  return {
    "@type": "MerchantReturnPolicy",
    "@id": `${policyUrl}#return-policy`,
    applicableCountry: "US",
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: days,
    returnMethod: "https://schema.org/ReturnByMail",
    returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
    merchantReturnLink: policyUrl,
    description: returns,
  };
}
