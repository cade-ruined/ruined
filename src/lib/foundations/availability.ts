import "server-only";

import { getOperatorRole } from "@/lib/platform/repository";

export function isFoundationsLaunched(): boolean {
  return process.env.MEMBERSHIP_FOUNDATIONS_LAUNCHED?.trim().toLowerCase() === "true";
}

/** The launch exception is checked against current server-side access on every request. */
export async function isFoundationsAvailableToMember(authUserId?: string | null): Promise<boolean> {
  if (isFoundationsLaunched()) return true;
  if (!authUserId) return false;
  try {
    return await getOperatorRole(authUserId) === "ops_admin";
  } catch (error) {
    console.error("Foundations Administrator access could not be verified", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return false;
  }
}

export class FoundationsNotLaunchedError extends Error {
  constructor() {
    super("Foundations is not open yet.");
    this.name = "FoundationsNotLaunchedError";
  }
}

export async function requireFoundationsAvailableToMember(authUserId: string): Promise<void> {
  if (!await isFoundationsAvailableToMember(authUserId)) throw new FoundationsNotLaunchedError();
}
