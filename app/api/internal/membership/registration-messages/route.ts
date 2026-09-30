import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processRegistrationMessageBatch } from "@/lib/membership/registration-message-delivery";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;

function authorized(request: Request): boolean {
  const expected=process.env.CRON_SECRET?.trim() ?? "";
  const header=request.headers.get("authorization") ?? "";
  const supplied=header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const encoder=new TextEncoder();
  const a=encoder.encode(expected),b=encoder.encode(supplied);
  return a.length>0 && a.length===b.length && timingSafeEqual(a,b);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({error:"Unauthorized"},{status:401});
  const result=await processRegistrationMessageBatch(10);
  return NextResponse.json(result,{status:result.ready || !result.enabled ? 200 : 503,
    headers:{"Cache-Control":"private, no-store"}});
}

export const POST=GET;
