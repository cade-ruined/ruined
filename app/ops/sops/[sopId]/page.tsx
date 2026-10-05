import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import OperatorSopEditor from "@/components/platform/OperatorSopEditor";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOperatorAccessContext } from "@/lib/platform/page-data";
import { getOpsSop } from "@/lib/platform/ops-sop-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";
import { getPreviewOpsSop } from "@/lib/platform/ops-sop-preview";

export const metadata: Metadata = { title: "SOP" };
export const dynamic = "force-dynamic";

export default async function SopPage({ params }: { params: Promise<{ sopId: string }> }) {
  const context = await getOperatorAccessContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  const { sopId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sopId)) notFound();
  if (context.state === "preview") {
    const editor = getPreviewOpsSop(sopId);
    if (!editor) notFound();
    return <OperatorSopEditor editor={editor} preview />;
  }
  if (!context.viewer || !context.role || context.state !== "authenticated") return <PlatformUnavailable accessHref="/ops/access" />;
  let editor;
  try {
    editor = await getOpsSop(context.viewer.authUserId, sopId);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError && error.code === "not_found") notFound();
    if (error instanceof OpsOperatingRepositoryError && error.code === "forbidden") return <PlatformUnavailable reason="operator_access" />;
    console.error("SOP could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
  if (!editor) notFound();
  return <OperatorSopEditor editor={editor} />;
}
