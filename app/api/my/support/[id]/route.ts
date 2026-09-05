import { handleSupportRequest } from "@/lib/support/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleSupportRequest(request, { ticketId: (await context.params).id });
}
export async function POST(request: Request, context: Context) {
  return handleSupportRequest(request, { ticketId: (await context.params).id });
}
