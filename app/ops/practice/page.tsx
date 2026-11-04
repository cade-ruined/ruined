import type { Metadata } from "next";
import { redirect } from "next/navigation";
import OperatorPracticeReleases from "@/components/platform/OperatorPracticeReleases";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOperatorAccessContext } from "@/lib/platform/page-data";
export const metadata: Metadata = { title: "Practice releases" };
export const dynamic = "force-dynamic";
export default async function OperationsPracticePage() {
  const context = await getOperatorAccessContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (context.state !== "authenticated" || !context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;
  if (context.role !== "ops_admin") return <PlatformUnavailable reason="operator_access" />;
  return <OperatorPracticeReleases />;
}
