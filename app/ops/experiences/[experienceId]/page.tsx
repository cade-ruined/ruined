import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import OperatorExperienceRecord from "@/components/platform/OperatorExperienceRecord";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import {
  getOpsExperienceManagementDirectory,
  getOpsExperienceRecord,
} from "@/lib/platform/ops-experience-repository";
import {
  getPreviewOpsExperienceRecord,
  PREVIEW_OPS_EXPERIENCE_DIRECTORY,
} from "@/lib/platform/ops-experience-preview";
import { getOperatorPageContext } from "@/lib/platform/page-data";

export const metadata: Metadata = { title: "Experience" };
export const dynamic = "force-dynamic";

export default async function OperationsExperiencePage({
  params,
}: {
  params: Promise<{ experienceId: string }>;
}) {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;
  const { experienceId } = await params;

  if (context.state === "preview") {
    const experience = getPreviewOpsExperienceRecord(experienceId);
    if (!experience) notFound();
    return (
      <OperatorExperienceRecord
        directory={{
          blocks: PREVIEW_OPS_EXPERIENCE_DIRECTORY.blocks,
          circles: PREVIEW_OPS_EXPERIENCE_DIRECTORY.circles,
        }}
        experience={experience}
        preview
      />
    );
  }
  if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;

  try {
    const [experience, directory] = await Promise.all([
      getOpsExperienceRecord(context.viewer.authUserId, experienceId),
      getOpsExperienceManagementDirectory(context.viewer.authUserId),
    ]);
    if (!experience) notFound();
    return (
      <OperatorExperienceRecord
        directory={{ blocks: directory.blocks, circles: directory.circles }}
        experience={experience}
      />
    );
  } catch (error) {
    console.error("Operations Experience record could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
