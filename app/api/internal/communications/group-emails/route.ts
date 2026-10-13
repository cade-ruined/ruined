import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processEmailGroupCampaignBatch } from "@/lib/communications/email-group-campaign-service";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=180;
export async function GET(request:Request) {
  const expected=process.env.CRON_SECRET?.trim() ?? "",provided=request.headers.get("authorization") ?? "";
  const encoder=new TextEncoder(),a=encoder.encode(`Bearer ${expected}`),b=encoder.encode(provided);
  if(!expected || a.length!==b.length || !timingSafeEqual(a,b)) return NextResponse.json({error:"Unauthorized"},{status:401});
  const result=await processEmailGroupCampaignBatch();
  return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
}
export const POST=GET;
