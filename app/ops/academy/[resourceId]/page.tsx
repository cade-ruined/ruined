import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import OperatorAcademyEditor from "@/components/platform/OperatorAcademyEditor";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOpsAcademyEditor } from "@/lib/platform/ops-academy-repository";
import { PREVIEW_OPS_ACADEMY_EDITOR } from "@/lib/platform/ops-academy-preview";
import { getOperatorPageContext } from "@/lib/platform/page-data";

export const metadata: Metadata = { title: "Academy lesson" };
export const dynamic = "force-dynamic";

export default async function OperationsAcademyEditorPage({
  params,
}: {
  params: Promise<{ resourceId: string }>;
}) {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;
  if (context.state === "preview") return <OperatorAcademyEditor editor={PREVIEW_OPS_ACADEMY_EDITOR} />;
  if (!context.viewer || context.role !== "ops_admin") {
    return <PlatformUnavailable reason="operator_access" />;
  }
  const { resourceId } = await params;
  let editor;
  try {
    editor = await getOpsAcademyEditor(context.viewer.authUserId, resourceId);
  } catch (error) {
    console.error("Operations Academy lesson could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
  if (!editor) notFound();
  return <OperatorAcademyEditor editor={editor} />;
}
