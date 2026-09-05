import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSupportAccessUrl } from "@/lib/auth/support-return";

import MemberSupport from "@/components/support/MemberSupport";
import { SupportUnavailable } from "@/components/support/SupportShared";
import { SupportError } from "@/lib/support/model";
import { getSupportPageContext } from "@/lib/support/page-context";
import { PREVIEW_SUPPORT_TICKETS } from "@/lib/support/preview";
import { listSupportTickets } from "@/lib/support/repository";

export const metadata: Metadata = { title: "Support | Ruined Members" };
export const dynamic = "force-dynamic";

export default async function MemberSupportPage() {
  const context = await getSupportPageContext();
  if (context.state === "signed_out") redirect(getSupportAccessUrl("/my/support"));
  if (context.state === "preview") return <MemberSupport tickets={PREVIEW_SUPPORT_TICKETS} writable={false} />;
  if (context.state !== "authenticated") return <SupportUnavailable denied={context.state === "denied"} />;
  try {
    const tickets = await listSupportTickets(context.viewer);
    return <MemberSupport tickets={tickets} writable />;
  } catch (error) {
    console.error("Member support could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <SupportUnavailable denied={error instanceof SupportError && error.status === 403} />;
  }
}
