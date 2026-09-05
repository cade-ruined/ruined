import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OperatorExperienceDirectory from "@/components/platform/OperatorExperienceDirectory";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOpsExperienceManagementDirectory } from "@/lib/platform/ops-experience-repository";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { PREVIEW_OPS_EXPERIENCE_DIRECTORY } from "@/lib/platform/ops-experience-preview";

export const metadata: Metadata = { title: "Experiences" };
export const dynamic = "force-dynamic";

export default async function OperationsExperiencesPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  if (context.state === "preview") {
    return (
      <OperatorExperienceDirectory
        directory={PREVIEW_OPS_EXPERIENCE_DIRECTORY}
        preview
      />
    );
  }
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;

  try {
    const directory = await getOpsExperienceManagementDirectory(context.viewer.authUserId);
    return (
      <OperatorExperienceDirectory
        directory={directory}
      />
    );
  } catch (error) {
    console.error("Operations Experience directory could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
