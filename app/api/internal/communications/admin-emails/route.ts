import { timingSafeEqual } from "node:crypto";
import { processAdminEmailBatch } from "@/lib/communications/admin-email-delivery";
import { opsJson } from "@/lib/platform/ops-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
async function processRequest(request: Request) {
  const expected = process.env.CRON_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const suppliedBytes = encoder.encode(supplied);
  if (!expected || !supplied || expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return opsJson({ error: "Unauthorized" }, 401);
  }
  try {
    const result = await processAdminEmailBatch(10);
    return opsJson(result, result.ready ? 200 : 503);
  } catch { return opsJson({ error: "The email queue is temporarily unavailable." }, 503); }
}
export const GET = processRequest;
export const POST = processRequest;
