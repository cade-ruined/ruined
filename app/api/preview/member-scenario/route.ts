import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { MEMBER_PREVIEW_COOKIE, memberPreviewScenario } from "@/lib/membership/preview-scenarios";

export async function POST(request: Request) {
  if (getPlatformConfiguration().mode !== "preview" || process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  if (!isTrustedPlatformOrigin(request)) return new NextResponse(null, { status: 403 });
  const scenario = memberPreviewScenario((await request.formData()).get("scenario"));
  const response = request.headers.get("accept")?.includes("application/json")
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL("/my", request.url), 303);
  response.cookies.set(MEMBER_PREVIEW_COOKIE, scenario, { httpOnly: true, sameSite: "strict", path: "/", maxAge: 3600, secure: new URL(request.url).protocol === "https:" });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
