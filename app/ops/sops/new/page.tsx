import type { Metadata } from "next";
import { redirect } from "next/navigation";
import OperatorSopEditor from "@/components/platform/OperatorSopEditor";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOperatorAccessContext } from "@/lib/platform/page-data";

export const metadata: Metadata = { title: "New SOP" };
export const dynamic = "force-dynamic";

export default async function NewSopPage() {
  const context = await getOperatorAccessContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "preview") return <OperatorSopEditor preview />;
  if (context.state === "denied" || (context.state === "authenticated" && context.role !== "ops_admin")) return <PlatformUnavailable reason="operator_access" />;
  if (!context.viewer || context.state !== "authenticated") return <PlatformUnavailable accessHref="/ops/access" />;
  return <OperatorSopEditor />;
}
