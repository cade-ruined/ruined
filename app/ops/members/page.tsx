import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OpsInvitationActions } from "@/components/platform/OpsActions";
import OperatorMemberDirectory from "@/components/platform/OperatorMemberDirectory";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import type { OperatorMemberSummary } from "@/lib/platform/model";
import { getOperatorPageContext } from "@/lib/platform/page-data";
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
  if (context.state === "denied") return <PlatformUnavailable title="Operator access required." />;
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

  const actions = context.role === "ops_admin" && context.viewer
    ? <OpsInvitationActions />
    : undefined;

  return (
    <OperatorPageFrame
      eyebrow="Members"
      introduction="Search the full membership roster you are authorized to see. Narrow it by payment attention, Foundations, or Circle placement without losing anyone beyond the first page."
      title="Members"
    >
      {actions ? <div className="mt-14">{actions}</div> : null}
      <OperatorMemberDirectory directory={directory} />
    </OperatorPageFrame>
  );
}
