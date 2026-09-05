import "server-only";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  getPlatformConfiguration,
  type PlatformConfiguration,
} from "@/lib/platform/config";
import type { PlatformViewer } from "@/lib/platform/model";

import { MembershipAccessDeniedError } from "@/lib/membership/repository";

export type MembershipPageState =
  | "authenticated"
  | "denied"
  | "preview"
  | "signed_out"
  | "unavailable";

export type MembershipPageContext<T> = {
  configuration: PlatformConfiguration;
  data: T | null;
  state: MembershipPageState;
  viewer: PlatformViewer | null;
};

function safeErrorDetails(error: unknown) {
  const errorCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : null;

  return {
    errorCode,
    errorType: error instanceof Error ? error.name : "UnknownError",
  };
}

export async function getMembershipPageContext<T>(
  preview: T,
  load: (authUserId: string) => Promise<T | null>,
  area: string,
): Promise<MembershipPageContext<T>> {
  const configuration = getPlatformConfiguration();

  if (configuration.mode === "preview") {
    return { configuration, data: preview, state: "preview", viewer: null };
  }
  if (configuration.mode === "unavailable") {
    return { configuration, data: null, state: "unavailable", viewer: null };
  }

  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return { configuration, data: null, state: "signed_out", viewer: null };
  }

  try {
    const data = await load(viewer.authUserId);
    return {
      configuration,
      data,
      state: data ? "authenticated" : "denied",
      viewer,
    };
  } catch (error) {
    if (error instanceof MembershipAccessDeniedError) {
      return { configuration, data: null, state: "denied", viewer };
    }
    console.error(`Ruined Membership ${area} could not be loaded`, safeErrorDetails(error));
    return { configuration, data: null, state: "unavailable", viewer };
  }
}
