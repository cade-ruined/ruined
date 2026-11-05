import { NextResponse } from "next/server";
import { resolveCurrentPlatformSession } from "@/lib/auth/session";
import { getMemberSearch } from "@/lib/membership/member-search-repository";
import { MemberSearchError, normalizeMemberSearchQuery, parseMemberSearchPage } from "@/lib/membership/member-search-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: {
  "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow",
} });

export async function GET(request: Request) {
  try {
    const session = await resolveCurrentPlatformSession();
    if (session.status === "unavailable") return response({ error: "Member search is temporarily unavailable. Please try again." }, 503);
    if (session.status !== "authenticated") return response({ error: "Sign in to browse members." }, 401);
    const params = new URL(request.url).searchParams;
    const query = normalizeMemberSearchQuery(params.get("q") ?? "");
    const page = parseMemberSearchPage(params.get("page"));
    return response(await getMemberSearch(session.viewer.authUserId, query, page));
  } catch (error) {
    if (error instanceof MemberSearchError) return response({ error: error.message }, error.status);
    console.error("Member search unavailable", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return response({ error: "Member search is temporarily unavailable. Please try again." }, 503);
  }
}
