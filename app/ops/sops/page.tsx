import type { Metadata } from "next";
import { redirect } from "next/navigation";
import OperatorSops from "@/components/platform/OperatorSops";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOperatorAccessContext } from "@/lib/platform/page-data";
import { getOpsSops } from "@/lib/platform/ops-sop-repository";
import { PREVIEW_OPS_SOPS } from "@/lib/platform/ops-sop-preview";

export const metadata: Metadata = { title: "SOPs" };
export const dynamic = "force-dynamic";

export default async function OperationsSopsPage() {
  const context = await getOperatorAccessContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (context.state === "preview") return <OperatorSops library={PREVIEW_OPS_SOPS} preview />;
  if (!context.viewer || !context.role || context.state !== "authenticated") return <PlatformUnavailable accessHref="/ops/access" />;
  try {
    return <OperatorSops library={await getOpsSops(context.viewer.authUserId)} />;
  } catch (error) {
    console.error("SOP library could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <PlatformUnavailable accessHref="/ops/access" />;
  }
}
