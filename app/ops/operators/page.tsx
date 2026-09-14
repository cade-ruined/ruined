import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import OperatorAccessManager, { type OperatorAccessSelectedMember } from "@/components/platform/OperatorAccessManager";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import {
  getOperatorAccessDirectory,
  type OperatorAccessEntry,
} from "@/lib/platform/ops-access-repository";
import { getPreviewOpsMemberRecord, PREVIEW_OPS_CIRCLES } from "@/lib/platform/ops-preview";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { getOpsCircleSummaries } from "@/lib/platform/ops-repository";
import { getOpsMemberOperatingRecord } from "@/lib/platform/ops-operating-repository";
import { getOperatorMemberDirectoryPage, type OperatorMemberDirectoryPage } from "@/lib/platform/repository";

export const metadata: Metadata = { title: "Operators" };
export const dynamic = "force-dynamic";

const PREVIEW_OPERATORS: OperatorAccessEntry[] = [
  {
    authUserId: "00000000-0000-4000-8000-000000000001",
    circles: [],
    displayName: "Cade Mangelson",
    email: "cade@theruinedproject.com",
    id: "operator:preview-admin",
    invitedAt: null,
    lastSignedInAt: "2026-08-29T15:30:00.000Z",
    role: "ops_admin",
    status: "active",
  },
  {
    authUserId: "00000000-0000-4000-8000-000000000002",
    circles: PREVIEW_OPS_CIRCLES.filter((circle) => circle.slug === "circle-01").map(({ id, name }) => ({ id, name })),
    displayName: "Tyler Bastian",
    email: "tyler@ruined.local",
    id: "operator:preview-shaper",
    invitedAt: null,
    lastSignedInAt: "2026-08-28T19:15:00.000Z",
    role: "circle_leader",
    status: "active",
  },
  {
    authUserId: null,
    circles: PREVIEW_OPS_CIRCLES.filter((circle) => circle.slug === "circle-02").map(({ id, name }) => ({ id, name })),
    displayName: "Jordan Lee",
    email: "jordan@ruined.local",
    id: "invitation:preview-guide",
    invitedAt: "2026-08-28T17:00:00.000Z",
    lastSignedInAt: null,
    role: "guide",
    status: "invited",
  },
];

export default async function OperationsOperatorsPage({ searchParams }: {
  searchParams?: Promise<{
    memberId?: string | string[];
    memberQuery?: string | string[];
    memberPage?: string | string[];
    chooseMember?: string | string[];
    add?: string | string[];
  }>;
}) {
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;
  if (context.role !== "ops_admin") return <PlatformUnavailable reason="operator_access" />;

  const preview = context.state === "preview";
  const params = await searchParams;
  const memberId = params?.memberId;
  const memberQuery = (typeof params?.memberQuery === "string" ? params.memberQuery : "")
    .trim().replace(/\s+/g, " ").slice(0, 120);
  const requestedPage = typeof params?.memberPage === "string" ? Number(params.memberPage) : 1;
  const memberPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  if (memberId !== undefined && (
    typeof memberId !== "string"
    || !(preview ? /^preview-0[1-4]$/ : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).test(memberId)
  )) notFound();
  let selectedMember: OperatorAccessSelectedMember | null = null;
  let memberRecord = preview && memberId ? getPreviewOpsMemberRecord(memberId) : null;
  let operators = preview ? PREVIEW_OPERATORS : null;
  let memberDirectory: OperatorMemberDirectoryPage | null = null;
  if (preview) {
    const members = context.dashboard.members.filter((member) => [member.name, member.email]
      .some((value) => value.toLowerCase().includes(memberQuery.toLowerCase())));
    const pageCount = Math.max(1, Math.ceil(members.length / 25));
    const page = Math.min(memberPage, pageCount);
    memberDirectory = {
      filter: "all", members: members.slice((page - 1) * 25, page * 25),
      page, pageCount, pageSize: 25, query: memberQuery, totalResults: members.length,
    };
  }
  let circles = preview
    ? PREVIEW_OPS_CIRCLES
        .filter((circle) => circle.status === "forming" || circle.status === "active")
        .map((circle) => ({ id: circle.id, name: circle.name }))
    : null;

  if (!preview && context.viewer) {
    try {
      const [directory, circleRows, selectedRecord, memberRows] = await Promise.all([
        getOperatorAccessDirectory(context.viewer.authUserId),
        getOpsCircleSummaries(context.viewer.authUserId),
        memberId ? getOpsMemberOperatingRecord(context.viewer.authUserId, memberId) : null,
        getOperatorMemberDirectoryPage(context.viewer.authUserId, { filter: "all", query: memberQuery, page: memberPage }),
      ]);
      memberRecord = selectedRecord;
      operators = directory;
      memberDirectory = memberRows;
      circles = circleRows
        .filter((circle) => circle.status === "forming" || circle.status === "active")
        .map((circle) => ({ id: circle.id, name: circle.name }));
    } catch (error) {
      console.error("Operator access management could not be loaded", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  if (!operators || !circles || !memberDirectory) return <PlatformUnavailable accessHref="/ops/access" />;
  if (memberId && !memberRecord) notFound();
  if (memberRecord) {
    selectedMember = {
      displayName: memberRecord.membership.contact.legalName || memberRecord.header.preferredName,
      email: memberRecord.header.primaryEmail,
      memberId: memberRecord.header.memberId,
    };
  }

  return (
    <OperatorPageFrame title="Operators">
      <OperatorAccessManager
        key={selectedMember?.memberId ?? `directory:${memberDirectory.query}:${memberDirectory.page}:${params?.add === "1"}:${params?.chooseMember === "1"}`}
        circles={circles}
        currentViewerAuthUserId={context.viewer?.authUserId ?? PREVIEW_OPERATORS[0].authUserId}
        initialOperators={operators}
        initialAddOpen={params?.add === "1"}
        initialMemberPickerOpen={params?.chooseMember === "1" || params?.memberQuery !== undefined || params?.memberPage !== undefined}
        memberSearch={{
          members: memberDirectory.members.map((member) => ({ memberId: member.memberId, displayName: member.name, email: member.email || null })),
          page: memberDirectory.page,
          pageCount: memberDirectory.pageCount,
          query: memberDirectory.query,
          totalResults: memberDirectory.totalResults,
        }}
        preview={preview}
        selectedMember={selectedMember}
      />
    </OperatorPageFrame>
  );
}
