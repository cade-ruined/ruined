import { after } from "next/server";

import { processCalendarReconciliationForExperience } from "@/lib/google/calendar-worker";
import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import {
  parseOpsExperienceCreateAndPublish,
  parseOpsExperienceDraft,
} from "@/lib/platform/ops-experience-api";
import {
  createAndPublishOpsExperience,
  createOpsExperience,
} from "@/lib/platform/ops-experience-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = await request.json().catch(() => null);
  const publish = body?.intent === "create_and_publish";
  const event = publish ? parseOpsExperienceCreateAndPublish(body) : null;
  const draft = publish ? null : parseOpsExperienceDraft(body);
  if (!event && !draft) return opsJson({
    error: publish ? "A title, Google Meet link, audience, and valid schedule are required." : "A valid Experience draft is required.",
  }, 400);

  try {
    const experience = event
      ? await createAndPublishOpsExperience({ actorAuthUserId: access.viewer.authUserId, event })
      : await createOpsExperience({ actorAuthUserId: access.viewer.authUserId, draft: draft! });
    if (event) {
      // Creation and delivery intent have committed together. A failed immediate
      // attempt remains in the durable queue for the protected worker to retry.
      try {
        after(async () => {
          try {
            await processCalendarReconciliationForExperience(experience.experienceId);
          } catch (error) {
            console.error("Immediate event calendar delivery will be retried", {
              experienceId: experience.experienceId,
              errorType: error instanceof Error ? error.name : "UnknownError",
            });
          }
        });
      } catch (error) {
        console.error("Event calendar delivery remains queued", {
          experienceId: experience.experienceId,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    return opsJson({ experience, ...(event ? { calendarDelivery: "queued" } : {}) }, 201);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Experience could not be created", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The event could not be created. Please try again." }, 503);
  }
}
