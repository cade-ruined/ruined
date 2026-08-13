import { NextResponse } from "next/server";
import { createCheckoutUrl, type CheckoutLine } from "@/lib/shopify";

const VARIANT_ID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const MAX_LINES = 25;
const MAX_QUANTITY = 20;

type RequestBody = {
  lines?: { variantId?: unknown; quantity?: unknown }[];
};

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

  const consolidated = new Map<string, number>();
  for (const line of body.lines) {
    const variantId = typeof line.variantId === "string" ? line.variantId : "";
    const quantity = typeof line.quantity === "number" ? Math.floor(line.quantity) : 0;
    if (!VARIANT_ID.test(variantId) || quantity < 1 || quantity > MAX_QUANTITY) {
      return NextResponse.json({ error: "One of the selected pieces is invalid." }, { status: 400 });
    }
    consolidated.set(
      variantId,
      Math.min(MAX_QUANTITY, (consolidated.get(variantId) ?? 0) + quantity)
    );
  }

  const lines: CheckoutLine[] = Array.from(consolidated, ([variantId, quantity]) => ({
    variantId,
    quantity,
  }));
  const checkoutUrl = await createCheckoutUrl(lines);
  if (!checkoutUrl) {
    return NextResponse.json(
      { error: "Checkout is temporarily unavailable. Your bag is still saved." },
      { status: 503 }
    );
  }

  return NextResponse.json({ checkoutUrl });
}
