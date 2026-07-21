import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createHmac, timingSafeEqual } from "node:crypto";

// On-demand ISR for the store. Wire a Shopify webhook (Settings → Notifications
// → Webhooks, or via the Admin API) for `products/create`, `products/update`,
// and `products/delete` to:
//
//   POST https://your-site.com/api/revalidate
//
// Shopify signs the raw request body with the app secret. Never put secrets in
// the URL: query strings are commonly retained in proxy and platform logs.
const recentWebhookIds = new Set<string>();
const MAX_RECENT_WEBHOOKS = 1_000;

export async function POST(req: NextRequest) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const signature = req.headers.get("x-shopify-hmac-sha256");
  const webhookId = req.headers.get("x-shopify-webhook-id");
  const topic = req.headers.get("x-shopify-topic");
  const body = await req.text();

  if (!secret || !signature) {
    return NextResponse.json({ ok: false, message: "Missing signature" }, { status: 401 });
  }

  const expected = createHmac("sha256", secret).update(body).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64");
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid signature" }, { status: 401 });
  }

  if (
    provided.length !== expected.length ||
    !timingSafeEqual(Uint8Array.from(provided), Uint8Array.from(expected))
  ) {
    return NextResponse.json({ ok: false, message: "Invalid signature" }, { status: 401 });
  }

  if (!topic?.startsWith("products/")) {
    return NextResponse.json({ ok: false, message: "Unsupported topic" }, { status: 400 });
  }

  if (webhookId && recentWebhookIds.has(webhookId)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }
  if (webhookId) {
    recentWebhookIds.add(webhookId);
    if (recentWebhookIds.size > MAX_RECENT_WEBHOOKS) {
      const oldest = recentWebhookIds.values().next().value as string | undefined;
      if (oldest) recentWebhookIds.delete(oldest);
    }
  }

  // Both surfaces read the same catalogue: the full /store gallery and the
  // home dive's store-room teaser shelf. Refresh both so a Shopify edit lands
  // everywhere at once.
  revalidatePath("/store");
  revalidatePath("/");
  return NextResponse.json({
    ok: true,
    revalidated: ["/store", "/"],
    now: Date.now(),
  });
}
