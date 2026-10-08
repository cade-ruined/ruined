import { AdminEmailAIError, generateAdminEmail, validateGenerationInput } from "@/lib/communications/admin-email-ai";
import { adminEmailErrorResponse, readAdminEmailJson, requireAdminEmailMutation } from "@/lib/communications/admin-email-api";
import { consumeAdminEmailGeneration } from "@/lib/communications/admin-email-repository";
import { opsJson } from "@/lib/platform/ops-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const access = await requireAdminEmailMutation(request);
    if ("response" in access) return access.response;
    const input = validateGenerationInput(await readAdminEmailJson(request));
    if (!process.env.OPENAI_API_KEY?.trim()) throw new AdminEmailAIError("ChatGPT drafting is not connected yet. You can still write and save an email manually.", 503);
    if (!await consumeAdminEmailGeneration(access.viewer.authUserId)) {
      return opsJson({ error: "You’ve reached the 30 drafts per hour limit. Continue editing manually or try again later." }, 429);
    }
    return opsJson({ draft: await generateAdminEmail(input) });
  } catch (error) { return adminEmailErrorResponse(error); }
}
