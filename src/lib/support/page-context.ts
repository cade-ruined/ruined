import "server-only";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import type { PlatformViewer } from "@/lib/platform/model";
import { getOperatorRole } from "@/lib/platform/repository";

type SupportPageContext =
  | { state: "authenticated"; viewer: PlatformViewer }
  | { state: "preview" | "signed_out" | "denied" | "unavailable"; viewer: null };

// Support deliberately does not depend on an active paid membership.
// The repository also checks ownership and operator permissions for every read/write.
export async function getSupportPageContext(operator = false): Promise<SupportPageContext> {
  const configuration = getPlatformConfiguration();
  if (configuration.mode === "preview") return { state: "preview", viewer: null };
  if (configuration.mode !== "connected") return { state: "unavailable", viewer: null };
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return { state: "signed_out", viewer: null };
    if (operator && await getOperatorRole(viewer.authUserId) !== "ops_admin") {
      return { state: "denied", viewer: null };
    }
    return { state: "authenticated", viewer };
  } catch (error) {
    console.error("Support access could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return { state: "unavailable", viewer: null };
  }
}
