import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSupportAccessUrl } from "@/lib/auth/support-return";

import { SupportUnavailable } from "@/components/support/SupportShared";
import SupportThread from "@/components/support/SupportThread";
import { SupportError } from "@/lib/support/model";
import { getSupportPageContext } from "@/lib/support/page-context";
import { PREVIEW_SUPPORT_TICKETS } from "@/lib/support/preview";
import { getSupportTicket } from "@/lib/support/repository";

export const metadata: Metadata = { title: "Support request | Ruined Members" };
export const dynamic = "force-dynamic";

export default async function MemberSupportRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSupportPageContext();
  const { id } = await params;
  if (context.state === "signed_out") redirect(getSupportAccessUrl(`/my/support/${id}`));
  if (context.state === "preview") {
    const ticket = PREVIEW_SUPPORT_TICKETS.find((item) => item.id === id);
    if (!ticket) notFound();
    return <SupportThread initialTicket={ticket} key={ticket.id} writable={false} />;
  }
  if (context.state !== "authenticated") return <SupportUnavailable denied={context.state === "denied"} />;
  let ticket;
  try {
    ticket = await getSupportTicket(context.viewer, id);
  } catch (error) {
    if (error instanceof SupportError && (error.status === 404 || error.status === 400)) notFound();
    console.error("Member support request could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <SupportUnavailable denied={error instanceof SupportError && error.status === 403} />;
  }
  return <SupportThread initialTicket={ticket} key={ticket.id} writable />;
}
