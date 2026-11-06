import "server-only";

import { cache } from "react";
import { resolveCurrentPlatformSession as resolveSession } from "./session";
import type { PlatformViewer } from "@/lib/platform/model";

// React shares this validated snapshot only during one Server Component render.
// API routes, session refresh and mutations continue to use ./session directly.
export const resolveCurrentPlatformSession = cache(resolveSession);

export async function getCurrentPlatformViewer(): Promise<PlatformViewer | null> {
  const session = await resolveCurrentPlatformSession();
  return session.status === "authenticated" ? session.viewer : null;
}
