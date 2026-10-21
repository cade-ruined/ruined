import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processMemberLifecycleEmailBatch } from "@/lib/communications/member-lifecycle-email-worker";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=180;
export async function GET(request:Request) {
  const expected=process.env.CRON_SECRET?.trim() ?? "",authorization=request.headers.get("authorization") ?? "";
  const supplied=authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const encoder=new TextEncoder(),a=encoder.encode(expected),b=encoder.encode(supplied);
  if (!a.length || a.length!==b.length || !timingSafeEqual(a,b)) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const result=await processMemberLifecycleEmailBatch();
    return NextResponse.json(result,{status:result.ready || !result.enabled ? 200 : 503,headers:{"Cache-Control":"private, no-store"}});
  } catch {
    return NextResponse.json({error:"Member lifecycle messages are unavailable."},{status:503,headers:{"Cache-Control":"private, no-store"}});
  }
}
export const POST=GET;
