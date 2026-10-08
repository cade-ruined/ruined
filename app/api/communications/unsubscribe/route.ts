import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { unsubscribeAdminEmail } from "@/lib/communications/admin-email-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function result(request: Request, status: string, oneClick: boolean, code = 200) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (oneClick) return NextResponse.json({ status }, { status: code, headers });
  const url = new URL("/communications/unsubscribe", request.url);
  url.searchParams.set("status", status);
  return NextResponse.redirect(url, { status: 303, headers });
}

export async function POST(request: Request) {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded")) return result(request, "invalid", true, 415);
  if (Number(request.headers.get("content-length")) > 2048) return result(request, "invalid", true, 413);
  const reader = request.body?.getReader();
  if (!reader) return result(request, "invalid", true, 400);
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2048) {
        await reader.cancel();
        return result(request, "invalid", true, 413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch { return result(request, "invalid", true, 400); }
  finally { reader.releaseLock(); }
  const form = new URLSearchParams(text);
  const oneClick = form.get("List-Unsubscribe") === "One-Click";
  // Mail providers perform RFC 8058 POSTs without browser Origin headers.
  // Both flows require an unguessable token; merely visiting the link is read-only.
  if (!oneClick && !isTrustedPlatformOrigin(request)) return result(request, "invalid", true, 403);
  const tokens = oneClick ? new URL(request.url).searchParams.getAll("token") : form.getAll("token");
  const token = tokens.length === 1 ? tokens[0] : "";
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return result(request, "invalid", oneClick, 400);
  try {
    const valid = await unsubscribeAdminEmail(token);
    return result(request, valid ? "unsubscribed" : "invalid", oneClick, valid ? 200 : 400);
  } catch {
    console.error("Admin email unsubscribe temporarily unavailable");
    return result(request, "unavailable", oneClick, 503);
  }
}
