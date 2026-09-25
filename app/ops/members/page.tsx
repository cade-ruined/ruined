import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OperatorDirectInvitations from "@/components/platform/OperatorDirectInvitations";
import { getOpsDirectInvitations, type OpsDirectInvitationPage } from "@/lib/platform/ops-direct-invitations-repository";
import OperatorMemberInvitations from "@/components/platform/OperatorMemberInvitations";
import OperatorMemberDirectory from "@/components/platform/OperatorMemberDirectory";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import OperatorPeopleWorkspace from "@/components/platform/OperatorPeopleWorkspace";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import type { OperatorMemberSummary } from "@/lib/platform/model";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { getPendingMemberInvitations, type PendingMemberInvitationPage } from "@/lib/platform/ops-member-invitation-repository";
import {
  getOperatorMemberDirectoryPage,
  type OperatorMemberDirectoryFilter,
  type OperatorMemberDirectoryPage,
} from "@/lib/platform/repository";

export const metadata: Metadata = { title: "Members" };
export const dynamic = "force-dynamic";

type SearchValue = string | string[] | undefined;

function firstSearchValue(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestedPage(value: string | undefined): number {
  const page = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function requestedFilter(value: string | undefined): OperatorMemberDirectoryFilter {
  if (value === "attention" || value === "foundations" || value === "unassigned") {
    return value;
  }
  return "all";
}

function previewDirectory(
  members: OperatorMemberSummary[],
  input: { filter?: string; page?: number; query?: string },
): OperatorMemberDirectoryPage {
  const filter = requestedFilter(input.filter);
  const query = (input.query ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const needle = query.toLowerCase();
  const pageSize = 25;
  const matches = members.filter((member) => {
    const matchesFilter = filter === "all"
      || (filter === "attention" && (
        member.billingState === "attention_required"
        || member.accountState === "suspended"
        || member.accountState === "closed"
      ))
      || (filter === "foundations" && member.foundationsState !== "completed")
      || (filter === "unassigned" && !member.circleName);
    if (!matchesFilter) return false;
    if (!needle) return true;
    return [member.name, member.email, member.circleName ?? "", member.blockName ?? ""]
      .some((value) => value.toLowerCase().includes(needle));
  });
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.min(input.page ?? 1, pageCount);
  const offset = (page - 1) * pageSize;
  return {
    filter,
    members: matches.slice(offset, offset + pageSize),
    page,
    pageCount,
    pageSize,
    query,
    totalResults: matches.length,
  };
}

export default async function OperationsMembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const params = await searchParams;
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  const input = {
    filter: firstSearchValue(params.filter),
    page: requestedPage(firstSearchValue(params.page)),
    query: firstSearchValue(params.q),
  };
  let directory: OperatorMemberDirectoryPage | null = null;
  if (context.state === "preview") {
    directory = previewDirectory(context.dashboard.members, input);
  } else if (context.viewer) {
    try {
      directory = await getOperatorMemberDirectoryPage(context.viewer.authUserId, input);
    } catch (error) {
      console.error("Operations member directory could not be loaded", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  if (!directory) return <PlatformUnavailable accessHref="/ops/access" />;

  let pendingInvitations: PendingMemberInvitationPage | null = context.state === "preview"
    ? { entries: [{ id: "preview-invitation", email: "sample.member@example.com", memberId: null, invitedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), status: "pending" }], query: "", page: 1, pageCount: 1, totalResults: 1 }
    : null;
  if (context.role === "ops_admin" && context.state !== "preview" && context.viewer) {
    try { pendingInvitations = await getPendingMemberInvitations(context.viewer.authUserId, { query: firstSearchValue(params.invitationQ), page: requestedPage(firstSearchValue(params.invitationPage)) }); }
    catch (error) { console.error("Pending member joining could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" }); }
  }
  let directInvitations: OpsDirectInvitationPage | null = context.state === "preview"
    ? { entries: [], query: "", page: 1, pageCount: 1, totalResults: 0, counts: { created: 0, pending: 0, sent: 0, failed: 0, accepted: 0, joined: 0, expired: 0, revoked: 0 } }
    : null;
  if (context.role === "ops_admin" && context.state !== "preview" && context.viewer) {
    try { directInvitations = await getOpsDirectInvitations(context.viewer.authUserId, { query: firstSearchValue(params.directInvitationQ), page: requestedPage(firstSearchValue(params.directInvitationPage)) }); }
    catch (error) { console.error("Direct invitations could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" }); }
  }
  const directoryParams = { q: directory.query, filter: directory.filter, page: String(directory.page) };
  const actions = context.role === "ops_admin" && (context.state === "preview" || context.viewer)
    ? <OperatorMemberInvitations data={pendingInvitations} directoryParams={directoryParams} preview={context.state === "preview"} showAdd={false} />
    : undefined;

  return (
    <OperatorPageFrame title="Members">
      <OperatorPeopleWorkspace pendingJoining={actions} directInvitations={context.role === "ops_admin" ? <OperatorDirectInvitations data={directInvitations} directoryParams={directoryParams} preview={context.state === "preview"} /> : undefined} preview={context.state === "preview"} showHistory={context.role === "ops_admin"}>
        <OperatorMemberDirectory directory={directory} />
      </OperatorPeopleWorkspace>
    </OperatorPageFrame>
  );
}
