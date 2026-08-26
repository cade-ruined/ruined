import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OperatorExperienceDirectory from "@/components/platform/OperatorExperienceDirectory";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOpsExperienceDirectory } from "@/lib/platform/ops-operating-repository";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { PREVIEW_OPS_EXPERIENCES } from "@/lib/platform/ops-preview";

export const metadata: Metadata = { title: "Experiences" };
export const dynamic = "force-dynamic";

export default async function OperationsExperiencesPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  if (context.state === "preview") {
    return <OperatorExperienceDirectory experiences={PREVIEW_OPS_EXPERIENCES} />;
  }
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;

  try {
    const experiences = await getOpsExperienceDirectory(context.viewer.authUserId);
    return <OperatorExperienceDirectory experiences={experiences} />;
  } catch (error) {
    console.error("Operations Experience directory could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
