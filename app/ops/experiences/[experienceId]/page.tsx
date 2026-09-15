import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import OperatorExperienceRecord from "@/components/platform/OperatorExperienceRecord";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { OPERATOR_BUTTON_CLASS } from "@/components/platform/operatorStyles";
import {
  getOpsExperienceManagementDirectory,
  getOpsExperienceRecord,
} from "@/lib/platform/ops-experience-repository";
import {
  getPreviewOpsExperienceRecord,
  PREVIEW_OPS_EXPERIENCE_DIRECTORY,
} from "@/lib/platform/ops-experience-preview";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

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

  let experience: Awaited<ReturnType<typeof getOpsExperienceRecord>>;
  let directory: Awaited<ReturnType<typeof getOpsExperienceManagementDirectory>>;
  try {
    [experience, directory] = await Promise.all([
      getOpsExperienceRecord(context.viewer.authUserId, experienceId),
      getOpsExperienceManagementDirectory(context.viewer.authUserId),
    ]);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) {
      if (error.code === "not_found" || error.code === "invalid_request") notFound();
      if (error.code === "forbidden") return <PlatformUnavailable reason="operator_access" />;
    }
    const errorCode = typeof error === "object" && error !== null && "code" in error
      && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null;
    console.error("Operations Experience record could not be loaded", {
      errorCode,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return (
      <section className="space-y-5 py-8" aria-labelledby="experience-load-error">
        <h1 id="experience-load-error" className="font-[var(--font-display)] text-4xl leading-tight sm:text-5xl">
          This Experience couldn’t load.
        </h1>
        <p className="max-w-xl text-base text-black/65">
          Try loading it again, or return to Experiences. You don’t need to create another event.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <a className={OPERATOR_BUTTON_CLASS} href={`/ops/experiences/${encodeURIComponent(experienceId)}`}>
            Try again
          </a>
          <Link className="py-3 underline underline-offset-4" href="/ops/experiences">Back to Experiences</Link>
        </div>
      </section>
    );
  }
  // Keep Next's 404 outside the error handler: a missing record is not a
  // database outage, and must never become a passwordless sign-in prompt.
  if (!experience) notFound();
  return (
    <OperatorExperienceRecord
      directory={{ blocks: directory.blocks, circles: directory.circles }}
      experience={experience}
    />
  );
}
