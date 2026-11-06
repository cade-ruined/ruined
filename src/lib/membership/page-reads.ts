import "server-only";

import { cache } from "react";
import { getMemberRegistration as readRegistration } from "./registration-repository";
import { memberRegistrationDestination } from "./registration-routing";
import { getPlatformConfiguration } from "@/lib/platform/config";

// Navigation and page redirects use one registration snapshot per server render.
// Do not use this snapshot for mutations, current authorization or read retries.
export const getMemberRegistration = cache(readRegistration);

export async function getMemberRegistrationDestination(authUserId: string): Promise<string | null> {
  const registration = await getMemberRegistration(authUserId);
  const configuration = getPlatformConfiguration();
  return memberRegistrationDestination(registration, configuration.stripeActivationReady || configuration.stripeCheckoutReady);
}
