import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: unknown; source?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const source = body?.source === "artifacts" || body?.source === "about" ? body.source : "store";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  const portalId = process.env.HUBSPOT_PORTAL_ID;
  const formId = source === "artifacts" ? process.env.HUBSPOT_ARTIFACTS_FORM_ID : source === "about" ? process.env.HUBSPOT_ABOUT_FORM_ID : process.env.HUBSPOT_STORE_FORM_ID;
  if (!portalId || !formId) return NextResponse.json({ error: "HubSpot is not configured" }, { status: 503 });
  const response = await fetch(`https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: [{ name: "email", value: email }], context: { pageUri: process.env.NEXT_PUBLIC_SITE_URL, pageName: source === "artifacts" ? "Artifacts coming soon" : "Store coming soon" } }) });
  return response.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "HubSpot rejected submission" }, { status: 502 });
}
