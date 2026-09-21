import { type NextRequest, NextResponse } from "next/server";

import { resolvePlatformSession, type PlatformSession } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { createSupabaseCurrentResponseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Hold the SDK's cookie changes on one response until the outcome is known.
  const refreshed = NextResponse.json({});
  let session: PlatformSession = { status: "unavailable" };
  try {
    if (getPlatformConfiguration().mode === "connected") {
      const supabase = createSupabaseCurrentResponseClient({ request, response: refreshed });
      session = await resolvePlatformSession(supabase, { verifyCurrentUser: true });
    }
  } catch {
    // Setup/network failure must not instruct the browser to discard its login.
  }
  const owner = request.headers.get("X-Ruined-Session-Owner");
  const accountChanged = session.status === "authenticated" && owner !== null
    && owner.toLowerCase() !== session.viewer.authUserId.toLowerCase();
  const status = accountChanged ? 409 : session.status === "authenticated" ? 200 : session.status === "signed_out" ? 401 : 503;
  const response = NextResponse.json({ status: accountChanged ? "account_changed" : session.status }, { status });
  refreshed.headers.forEach((value, name) => {
    if (name !== "set-cookie" && name !== "content-type") response.headers.set(name, value);
  });
  const cookieChanges = refreshed.cookies.getAll();
  if (status !== 503 || cookieChanges.some(cookie => cookie.value !== "")) {
    cookieChanges.forEach(cookie => response.cookies.set(cookie));
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  const vary = response.headers.get("Vary");
  response.headers.set("Vary", vary && !vary.split(",").some(value => value.trim().toLowerCase() === "cookie") ? `${vary}, Cookie` : vary || "Cookie");
  if (status === 503) response.headers.set("Retry-After", "5");
  return response;
}
