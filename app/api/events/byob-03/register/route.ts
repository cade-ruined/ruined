import { BYOB_03_REGISTRATION } from "@/lib/events/byob-registration-model";
import { handleByobRegistration } from "@/lib/events/byob-registration-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleByobRegistration(request, BYOB_03_REGISTRATION);
}
