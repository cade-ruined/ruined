import "server-only";

import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration, type PlatformConfiguration } from "@/lib/platform/config";
import {
  PREVIEW_MEMBER,
  PREVIEW_OPERATOR_DASHBOARD,
  type MemberPlatformSnapshot,
  type OperatorDashboardSnapshot,
  type PlatformViewer,
} from "@/lib/platform/model";
import {
  getMemberPlatformSnapshot,
  getOperatorDashboard,
  type OperatorRole,
} from "@/lib/platform/repository";

type PageState = "authenticated" | "denied" | "preview" | "signed_out" | "unavailable";

export type MemberPageContext = {
  configuration: PlatformConfiguration;
  member: MemberPlatformSnapshot | null;
  state: PageState;
  viewer: PlatformViewer | null;
};

export type OperatorPageContext = {
  configuration: PlatformConfiguration;
  dashboard: OperatorDashboardSnapshot | null;
  role: OperatorRole | null;
  state: PageState;
  viewer: PlatformViewer | null;
};

export async function getMemberPageContext(): Promise<MemberPageContext> {
  const configuration = getPlatformConfiguration();

  if (configuration.mode === "preview") {
    return { configuration, member: PREVIEW_MEMBER, state: "preview", viewer: null };
  }
  if (configuration.mode === "unavailable") {
    return { configuration, member: null, state: "unavailable", viewer: null };
  }

  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return { configuration, member: null, state: "signed_out", viewer: null };

  try {
    const member = await getMemberPlatformSnapshot(viewer.authUserId);
    return {
      configuration,
      member,
      state: member ? "authenticated" : "denied",
      viewer,
    };
  } catch (error) {
    console.error("My Ruined member context could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return { configuration, member: null, state: "unavailable", viewer };
  }
}
export async function getOperatorPageContext(): Promise<OperatorPageContext> {
  const configuration = getPlatformConfiguration();

  if (configuration.mode === "preview") {
    return {
      configuration,
      dashboard: PREVIEW_OPERATOR_DASHBOARD,
      role: "ops_admin",
      state: "preview",
      viewer: null,
    };
  }
  if (configuration.mode === "unavailable") {
    return { configuration, dashboard: null, role: null, state: "unavailable", viewer: null };
  }

  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return { configuration, dashboard: null, role: null, state: "signed_out", viewer: null };
  }

  try {
    const access = await getOperatorDashboard(viewer.authUserId);
    if (!access) {
      return { configuration, dashboard: null, role: null, state: "denied", viewer };
    }
    return {
      configuration,
      dashboard: access.dashboard,
      role: access.role,
      state: "authenticated",
      viewer,
    };
  } catch (error) {
    console.error("Ruined operations context could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return { configuration, dashboard: null, role: null, state: "unavailable", viewer };
  }
}
