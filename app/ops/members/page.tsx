import type { Metadata } from "next";
import { PREVIEW_OPERATOR_DASHBOARD } from "@/lib/platform/model";
import { redirect } from "next/navigation";

import OperatorDirectInvitations from "@/components/platform/OperatorDirectInvitations";
import { getOpsDirectInvitations, type OpsDirectInvitationPage } from "@/lib/platform/ops-direct-invitations-repository";
import OperatorMemberInvitations from "@/components/platform/OperatorMemberInvitations";
import OperatorMemberDirectory from "@/components/platform/OperatorMemberDirectory";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import OperatorPeopleWorkspace from "@/components/platform/OperatorPeopleWorkspace";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import { normalizeOperatorMemberArchive, normalizeOperatorMemberSort, sortOperatorMembers } from "@/lib/platform/operator-member-directory";
import type { OperatorMemberSummary } from "@/lib/platform/model";
import { getOperatorAccessContext } from "@/lib/platform/page-data";
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
  input: { filter?: string; page?: number; query?: string; sort?: string; archive?: string },
): OperatorMemberDirectoryPage {
  const filter = requestedFilter(input.filter);
  const query = (input.query ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const needle = query.toLowerCase();
  const sort = normalizeOperatorMemberSort(input.sort);
  const archive = normalizeOperatorMemberArchive(input.archive);
  // Preview-only examples demonstrate each sort without reading or changing real members.
  const previewMembers = members.map((member, index): OperatorMemberSummary => {
    const createdAt = member.createdAt ?? ["2026-10-01T15:00:00Z", "2026-10-15T15:00:00Z", "2026-11-03T15:00:00Z", "2026-09-01T15:00:00Z"][index % 4];
    const complete = member.billingState === "active";
    const information = member.accountState !== "invited";
    return { ...member, createdAt, registration: member.registration ?? {
      state: complete ? "activated" : "collecting", registeredAt: complete ? createdAt : null,
      profileComplete: information, ready: complete, requiresInitialPayment: true, requiresPaymentMethod: true,
      completionBasis: complete ? "paid_membership" : null, emailVerified: true,
      paymentMethodState: information ? "saved" : "missing", paymentConfirmed: complete,
      billingArranged: complete, billingState: member.billingState, serviceStartsAt: complete ? "2026-11-05T22:00:00Z" : null,
      profileGranted: complete,
    } };
  });
  const matches = previewMembers.filter((member) => {
    if (archive === "current" && member.archivedAt || archive === "archived" && !member.archivedAt) return false;
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
  return {
    filter,
    sort,
    archive,
    canViewArchived: true,
    members: sortOperatorMembers(matches, sort),
    page: 1,
    pageCount: 1,
    pageSize: Math.max(1, matches.length),
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
  const context = await getOperatorAccessContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (context.state === "unavailable") return <PlatformUnavailable accessHref="/ops/access" />;

  const input = {
    filter: firstSearchValue(params.filter),
    sort: firstSearchValue(params.sort),
    archive: firstSearchValue(params.archive),
    query: firstSearchValue(params.q),
  };
  let directory: OperatorMemberDirectoryPage | null = null;
  if (context.state === "preview") {
    directory = previewDirectory(PREVIEW_OPERATOR_DASHBOARD.members, input);
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
  const directoryParams = { q: directory.query, filter: directory.filter, sort: directory.sort ?? "alphabetical", archive: directory.archive ?? "current" };
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
