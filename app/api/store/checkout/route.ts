import { NextResponse } from "next/server";
import { createCheckoutUrl, getProducts, type CheckoutLine } from "@/lib/shopify";

const VARIANT_ID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const MAX_LINES = 25;
const MAX_QUANTITY = 20;
const ALLOWED_LINE_FIELDS = new Set(["variantId", "quantity"]);

type RequestBody = {
  lines?: unknown;
};

type RequestLine = { variantId?: unknown; quantity?: unknown };

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "The bag could not be read." }, { status: 400 });
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > MAX_LINES) {
    return NextResponse.json({ error: "The bag is empty or too large." }, { status: 400 });
  }

  const requested = new Map<string, number>();
  for (const line of body.lines) {
    if (
      !line ||
      typeof line !== "object" ||
      Array.isArray(line) ||
      Object.keys(line).some((field) => !ALLOWED_LINE_FIELDS.has(field))
    ) {
      return NextResponse.json({ error: "One of the selected pieces is invalid." }, { status: 400 });
    }
    const requestLine = line as RequestLine;
    const variantId = typeof requestLine.variantId === "string" ? requestLine.variantId : "";
    const quantity = typeof requestLine.quantity === "number" ? Math.floor(requestLine.quantity) : 0;
    if (
      !VARIANT_ID.test(variantId) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      return NextResponse.json({ error: "One of the selected pieces is invalid." }, { status: 400 });
    }
    requested.set(
      variantId,
      Math.min(MAX_QUANTITY, (requested.get(variantId) ?? 0) + quantity)
    );
  }

  const products = await getProducts();
  if (!products.length) {
    return NextResponse.json(
      { error: "Checkout is temporarily unavailable. Your bag is still saved." },
      { status: 503 }
    );
  }

  const catalogueVariants = new Map(
    products.flatMap((product) =>
      product.variants.map((variant) => [variant.id, { product, variant }] as const)
    )
  );
  const lines: CheckoutLine[] = [];
  for (const [variantId, quantity] of requested) {
    const catalogueLine = catalogueVariants.get(variantId);
    if (!catalogueLine?.variant.available) {
      return NextResponse.json({ error: "One of the selected pieces is unavailable." }, { status: 400 });
    }
    const expectedShipDate = catalogueLine.product.expectedShipDate?.trim();
    lines.push({
      variantId,
      quantity,
      ...(expectedShipDate
        ? {
            attributes: [
              { key: "Order type", value: "Preorder" },
              { key: "Expected ship date", value: expectedShipDate },
            ],
          }
        : {}),
    });
  }

  const checkoutUrl = await createCheckoutUrl(lines);
  if (!checkoutUrl) {
    return NextResponse.json(
      { error: "Checkout is temporarily unavailable. Your bag is still saved." },
      { status: 503 }
    );
  }

  return NextResponse.json({ checkoutUrl });
}
