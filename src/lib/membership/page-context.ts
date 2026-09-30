import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMemberRegistrationDestination } from "./registration-repository";
import { MEMBER_PREVIEW_COOKIE, memberPreviewScenario, memberPreviewSnapshot } from "@/lib/membership/preview-scenarios";

import { resolveCurrentPlatformSession } from "@/lib/auth/session";
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
    const scenario = memberPreviewScenario((await cookies()).get(MEMBER_PREVIEW_COOKIE)?.value);
    return { configuration, data: memberPreviewSnapshot(preview, scenario), state: "preview", viewer: null };
  }
  if (configuration.mode === "unavailable") {
    return { configuration, data: null, state: "unavailable", viewer: null };
  }

  let viewer: PlatformViewer | null = null;
  try {
    const session = await resolveCurrentPlatformSession();
    if (session.status !== "authenticated") {
      return { configuration, data: null, state: session.status, viewer: null };
    }
    viewer = session.viewer;
  } catch (error) {
    console.error(`Ruined Membership ${area} session could not be loaded`, safeErrorDetails(error));
    return { configuration, data: null, state: "unavailable", viewer };
  }
  let destination: string | null = null;
  if (!["entry", "payment-method", "registration"].includes(area)) {
    try { destination = await getMemberRegistrationDestination(viewer.authUserId); }
    catch (error) {
      console.error(`Ruined Membership ${area} registration could not be loaded`, safeErrorDetails(error));
      return { configuration, data: null, state: "unavailable", viewer };
    }
  }
  if (destination) redirect(destination);
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
