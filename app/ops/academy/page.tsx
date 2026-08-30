import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OperatorAcademy from "@/components/platform/OperatorAcademy";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import {
  getOpsAcademyReferenceOptions,
  getOpsAcademySnapshot,
} from "@/lib/platform/ops-academy-repository";
import { PREVIEW_OPS_ACADEMY, PREVIEW_OPS_ACADEMY_EDITOR } from "@/lib/platform/ops-academy-preview";
import { getOperatorPageContext } from "@/lib/platform/page-data";

export const metadata: Metadata = { title: "Academy" };
export const dynamic = "force-dynamic";

export default async function OperationsAcademyPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;
  if (context.state === "preview") {
    return <OperatorAcademy academy={PREVIEW_OPS_ACADEMY} options={PREVIEW_OPS_ACADEMY_EDITOR.options} />;
  }
  if (!context.viewer || context.role !== "ops_admin") {
    return <PlatformUnavailable reason="operator_access" />;
  }
  try {
    const [academy, options] = await Promise.all([
      getOpsAcademySnapshot(context.viewer.authUserId),
      getOpsAcademyReferenceOptions(context.viewer.authUserId),
    ]);
    return <OperatorAcademy academy={academy} options={options} />;
  } catch (error) {
    console.error("Operations Academy could not be loaded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
