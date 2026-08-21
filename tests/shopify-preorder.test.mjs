import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [shopify, products, checkoutRoute, revalidateRoute, bagStore, bagPage, bagRoute, purchase, storeRoute, productRoute] =
  await Promise.all([
    read("src/lib/shopify.ts"),
    read("src/data/products.ts"),
    read("app/api/store/checkout/route.ts"),
    read("app/api/revalidate/route.ts"),
    read("src/components/store/bag-store.ts"),
    read("src/components/store/BagPageClient.tsx"),
    read("app/bag/page.tsx"),
    read("src/components/store/ProductPurchase.tsx"),
    read("app/store/page.tsx"),
    read("app/store/[handle]/page.tsx"),
  ]);

test("Shopify queries and maps only the expected ship-date preorder marker", () => {
  assert.match(shopify, /namespace:\s*"custom",\s*key:\s*"expected_ship_date"/);
  assert.match(shopify, /images\(first:\s*12\)/);
  assert.match(shopify, /images:\s*images\.length\s*\?\s*images\s*:\s*featuredImage\s*\?\s*\[featuredImage\]\s*:\s*\[\]/);
  assert.match(products, /export type ProductImage/);
  assert.match(products, /images\?:\s*ProductImage\[\]/);
  assert.match(shopify, /expectedShipDate:\s*meta\.expected_ship_date\s*\|\|\s*undefined/);
  assert.match(products, /expectedShipDate\?:\s*string/);

  const nativeSellingPlanSurfaces = [shopify, products, checkoutRoute, bagStore, bagPage, purchase]
    .join("\n");
  assert.doesNotMatch(nativeSellingPlanSurfaces, /sellingPlanAllocations/);
  assert.doesNotMatch(nativeSellingPlanSurfaces, /requiresSellingPlan/);
  assert.doesNotMatch(nativeSellingPlanSurfaces, /sellingPlanId/);
});

test("checkout can use the Ruined public checkout hostname without trusting the browser", () => {
  assert.match(shopify, /process\.env\.SHOPIFY_CHECKOUT_DOMAIN/);
  assert.match(shopify, /const CHECKOUT_HOSTNAME/);
  assert.match(shopify, /function resolvePublicCheckoutUrl\(checkoutUrl:\s*string\)/);
  assert.match(shopify, /url\.hostname\s*=\s*publicCheckoutDomain/);
  assert.match(shopify, /resolvePublicCheckoutUrl\(result\.cart\.checkoutUrl\)/);
  assert.doesNotMatch(checkoutRoute, /checkoutDomain|SHOPIFY_CHECKOUT_DOMAIN/);
});

test("checkout derives preorder attributes from the trusted Shopify catalogue", () => {
  assert.match(checkoutRoute, /createCheckoutUrl,\s*getProducts,\s*type CheckoutLine/);
  assert.match(checkoutRoute, /const products = await getProducts\(\)/);
  assert.match(
    checkoutRoute,
    /products\.flatMap\(\(product\)\s*=>[\s\S]*?product\.variants\.map\(\(variant\)\s*=>\s*\[variant\.id,\s*\{ product, variant \}\]/
  );
  assert.match(checkoutRoute, /if \(!catalogueLine\?\.variant\.available\)/);
  assert.match(
    checkoutRoute,
    /const expectedShipDate = catalogueLine\.product\.expectedShipDate\?\.trim\(\)/
  );
  assert.match(
    checkoutRoute,
    /attributes:\s*\[[\s\S]*?\{ key:\s*"Order type",\s*value:\s*"Preorder" \}[\s\S]*?\{ key:\s*"Expected ship date",\s*value:\s*expectedShipDate \}[\s\S]*?\]/
  );
  assert.match(checkoutRoute, /const checkoutUrl = await createCheckoutUrl\(lines\)/);

  assert.match(
    shopify,
    /type CheckoutLine\s*=\s*\{[\s\S]*?attributes\?:\s*\{ key:\s*string;\s*value:\s*string \}\[\]/
  );
  assert.match(
    shopify,
    /\.\.\.\(line\.attributes\?\.length\s*\?\s*\{ attributes:\s*line\.attributes \}\s*:\s*\{\}\)/
  );
  assert.match(shopify, /result\.userErrors\.length\s*>\s*0/);
  assert.match(shopify, /warnings\s*\{\s*code\s+message\s+target\s*\}/);
  assert.match(shopify, /result\.warnings\.length\s*>\s*0/);
});

test("the browser cannot provide trusted preorder dates or checkout attributes", () => {
  assert.match(
    checkoutRoute,
    /const ALLOWED_LINE_FIELDS = new Set\(\["variantId",\s*"quantity"\]\)/
  );
  assert.match(checkoutRoute, /type RequestBody\s*=\s*\{\s*lines\?:\s*unknown;\s*\}/);
  assert.match(
    checkoutRoute,
    /Object\.keys\(line\)\.some\(\(field\)\s*=>\s*!ALLOWED_LINE_FIELDS\.has\(field\)\)/
  );

  const checkoutRequest = bagPage.slice(
    bagPage.indexOf("async function beginCheckout"),
    bagPage.indexOf("if (!hydrated)")
  );
  assert.match(
    checkoutRequest,
    /lines:\s*displayItems\.map\(\(item\)\s*=>\s*\(\{\s*variantId:\s*item\.variantId,\s*quantity:\s*item\.quantity,?\s*\}\)\)/
  );
  assert.doesNotMatch(checkoutRequest, /expectedShipDate|attributes|Order type|Expected ship date/);
});

test("product and bag present the restrained pay-in-full preorder promise", () => {
  assert.match(purchase, /const expectedShipDate = formatExpectedShipDate\(product\.expectedShipDate\)/);
  assert.match(purchase, /const isPreorder = Boolean\(expectedShipDate\)/);
  assert.match(purchase, /expectedShipDate:\s*product\.expectedShipDate/);
  assert.match(purchase, /Preorder — pay in full/);
  assert.match(
    purchase,
    /Pay \{formatPriceForSentence\(selectedVariant\?\.price \?\? product\.price\)\} now\. Expected to ship \{expectedShipDate\}\./
  );
  assert.match(purchase, /isPreorder\s*\?\s*"Preorder"\s*:\s*"Add to bag"/);
  assert.match(purchase, /options\.slice\(0, optionIndex\)/);
  assert.match(purchase, /setSelection\(\(current\)\s*=>[\s\S]*Object\.fromEntries/);

  assert.match(bagStore, /expectedShipDate\?:\s*string/);
  assert.match(bagStore, /isOptionalString\(item\.expectedShipDate\)/);
  assert.match(bagStore, /expectedShipDate:\s*item\.expectedShipDate/);
  assert.match(bagPage, /item\.expectedShipDate\s*&&/);
  assert.match(bagPage, /Preorder — pay in full/);
  assert.match(bagRoute, /const products = await getProducts\(\)/);
  assert.match(bagRoute, /<BagPageClient email=\{email\} products=\{products\}/);
  assert.match(bagPage, /resolveBagItems\(items, products\)/);
  assert.match(bagPage, /unitPrice:\s*current\.variant\.price/);
  assert.match(bagPage, /priceAmount:\s*current\.variant\.priceAmount/);
  assert.match(
    bagPage,
    /Pay \{formatPriceForSentence\(item\.unitPrice\)\} now\. Expected to ship \{formatExpectedShipDate\(item\.expectedShipDate\)\}\./
  );
});

test("normal products retain normal bag identity, copy, and attribute-free checkout", () => {
  const localCatalogue = products.slice(products.indexOf("export const PRODUCTS"));
  assert.doesNotMatch(localCatalogue, /expectedShipDate\s*:/);
  assert.match(purchase, /isPreorder\s*\?\s*"Preorder"\s*:\s*"Add to bag"/);
  assert.match(bagStore, /return `\$\{productId\}::\$\{variantId\}`/);

  assert.match(
    checkoutRoute,
    /\.\.\.\(expectedShipDate[\s\S]*?\?\s*\{[\s\S]*?attributes:[\s\S]*?\}[\s\S]*?:\s*\{\}\)/
  );
  assert.match(
    shopify,
    /\.\.\.\(line\.attributes\?\.length\s*\?\s*\{ attributes:\s*line\.attributes \}\s*:\s*\{\}\)/
  );
});

test("catalogue consumers cannot freeze a Draft-time snapshot", () => {
  for (const route of [storeRoute, productRoute, bagRoute]) {
    assert.match(route, /export const dynamic = "force-dynamic"/);
  }
  assert.doesNotMatch(productRoute, /generateStaticParams/);
});

test("product and publication webhooks refresh every catalogue consumer and fail closed", () => {
  for (const topic of [
    "products/create",
    "products/update",
    "products/delete",
    "product_publications/create",
    "product_publications/update",
    "product_publications/delete",
  ]) {
    assert.match(revalidateRoute, new RegExp(`"${topic}"`));
  }
  assert.match(revalidateRoute, /SUPPORTED_TOPICS\.has\(topic\)/);
  assert.doesNotMatch(revalidateRoute, /startsWith\("products\/"\)/);
  assert.match(revalidateRoute, /revalidatePath\("\/store\/\[handle\]",\s*"page"\)/);
  assert.match(revalidateRoute, /revalidatePath\("\/bag"\)/);
  assert.match(revalidateRoute, /revalidated:\s*\["\/store",\s*"\/store\/\[handle\]",\s*"\/bag",\s*"\/"\]/);
  assert.doesNotMatch(revalidateRoute, /selling[_-]plan/i);
});
