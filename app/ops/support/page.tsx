import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSupportAccessUrl } from "@/lib/auth/support-return";

import OperatorSupport from "@/components/support/OperatorSupport";
import { SupportUnavailable } from "@/components/support/SupportShared";
import { getSupportEmailConfiguration } from "@/lib/support/delivery";
import { SupportError } from "@/lib/support/model";
import { getSupportPageContext } from "@/lib/support/page-context";
import { PREVIEW_SUPPORT_TICKETS } from "@/lib/support/preview";
import { listSupportTickets } from "@/lib/support/repository";

export const metadata: Metadata = { title: "Support" };
export const dynamic = "force-dynamic";

export default async function OperationsSupportPage() {
  const context = await getSupportPageContext(true);
  if (context.state === "signed_out") redirect(getSupportAccessUrl("/ops/support"));
  if (context.state === "preview") return <OperatorSupport tickets={PREVIEW_SUPPORT_TICKETS} writable={false} />;
  if (context.state !== "authenticated") return <SupportUnavailable denied={context.state === "denied"} />;
  try {
    const tickets = await listSupportTickets(context.viewer, true);
    return <OperatorSupport emailReady={getSupportEmailConfiguration().ready} tickets={tickets} writable />;
  } catch (error) {
    console.error("Operator support queue could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <SupportUnavailable denied={error instanceof SupportError && error.status === 403} />;
  }
}
