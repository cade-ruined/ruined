import { NextResponse } from "next/server";

const ALLOWED_ROLES = new Set([
  "Founder / business owner",
  "Creative leader",
  "Independent creator",
  "Executive / operator",
  "Other",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (clean(body.website, 200)) return NextResponse.json({ ok: true });

  const fullName = clean(body.fullName, 100);
  const email = clean(body.email, 254).toLowerCase();
  const role = clean(body.role, 80);
  const goal = clean(body.goal, 1500);
  const consent = body.consent === true || body.consent === "on";
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!fullName || !validEmail || !ALLOWED_ROLES.has(role) || goal.length < 20 || !consent) {
    return NextResponse.json({ error: "Please complete every required field" }, { status: 400 });
  }

  const webhookUrl = process.env.LEAD_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ error: "Lead connection is not configured" }, { status: 503 });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LEAD_WEBHOOK_SECRET ? { Authorization: `Bearer ${process.env.LEAD_WEBHOOK_SECRET}` } : {}),
      },
      body: JSON.stringify({
        fullName,
        email,
        role,
        goal,
        consent: true,
        source: "after-the-fear-lp",
        submittedAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Lead provider rejected request" }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ error: "Lead provider is unavailable" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
