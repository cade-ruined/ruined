import type { Metadata } from "next";
import { redirect } from "next/navigation";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import OperatorRegistrations, { type OperatorRegistrationRow } from "@/components/platform/OperatorRegistrations";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { getOpsMemberRegistrations } from "@/lib/membership/registration-repository";

export const metadata: Metadata = { title: "Registrations | Ruined Operations", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const previewRows: OperatorRegistrationRow[] = [
  { memberId: "00000000-0000-4000-8000-000000000101", name: "Cherry Hill", email: "cherry@example.test", state: "registered", registeredAt: "2026-09-30T12:00:00Z", profileActivatedAt: null, requiresPaymentMethod: true, requiresInitialPayment: false, completionBasis: "saved_card", initialPayment: null, profileComplete: true, ready: true, version: 2, welcomeStatus: "sent", activationEmailStatus: null },
  { memberId: "00000000-0000-4000-8000-000000000102", name: "Alex Rivera", email: "alex@example.test", state: "registered", registeredAt: "2026-09-30T13:00:00Z", profileActivatedAt: null, requiresPaymentMethod: false, requiresInitialPayment: false, completionBasis: "complimentary", initialPayment: null, profileComplete: true, ready: true, version: 2, welcomeStatus: "pending", activationEmailStatus: null },
  { memberId: "00000000-0000-4000-8000-000000000103", name: "Jordan Ellis", email: "jordan@example.test", state: "collecting", registeredAt: null, profileActivatedAt: null, requiresPaymentMethod: true, requiresInitialPayment: false, completionBasis: null, initialPayment: null, profileComplete: true, ready: false, version: 1, welcomeStatus: null, activationEmailStatus: null },
];

export default async function OperationsRegistrationsPage() {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied" || (context.state !== "preview" && context.role !== "ops_admin")) return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;
  let rows: OperatorRegistrationRow[];
  if (context.state === "preview") rows = previewRows;
  else {
    if (!context.viewer) return <PlatformUnavailable accessHref="/ops/access" />;
    try { rows = await getOpsMemberRegistrations(context.viewer.authUserId); }
    catch (error) {
      console.error("Registration directory unavailable", { errorType: error instanceof Error ? error.name : "UnknownError" });
      return <PlatformUnavailable accessHref="/ops/access" />;
    }
  }
  return <OperatorPageFrame title="Registrations"><OperatorRegistrations rows={rows} preview={context.state === "preview"} /></OperatorPageFrame>;
}
