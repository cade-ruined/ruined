import { handleSupportRequest } from "@/lib/support/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleSupportRequest(request, { operator: true });
