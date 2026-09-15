import { redirect } from "next/navigation";

import OperatorCirclesManager from "@/components/platform/OperatorCirclesManager";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import OperatorCircleCommunicationPanel from "@/components/platform/OperatorCircleCommunicationPanel";
import OpsCircleManagementActions from "@/components/platform/OpsCircleManagementActions";
import StateLabel from "@/components/platform/StateLabel";
import PlatformUnavailable from "@/components/platform/PlatformUnavailable";
import type { OpsCircleCommunicationItem } from "@/lib/platform/ops-model";
import { getOpsCircleCommunicationDirectory } from "@/lib/platform/ops-operating-repository";
import {
  PREVIEW_OPS_CIRCLE_COMMUNICATIONS,
  PREVIEW_OPS_CIRCLE_MANAGEMENT,
  PREVIEW_OPS_CIRCLES,
} from "@/lib/platform/ops-preview";
import {
  getOpsCircleManagementOptions,
  getOpsCircleMemberAssignments,
  getOpsCircleSummaries,
  type OpsCircleMemberAssignment,
  type OpsCircleManagementOptions,
  type OpsCircleSummary,
} from "@/lib/platform/ops-repository";
import { getOperatorPageContext } from "@/lib/platform/page-data";
import { getOperatorMemberDirectoryPage } from "@/lib/platform/repository";
import { getOpsExperienceManagementDirectory } from "@/lib/platform/ops-experience-repository";
import { PREVIEW_OPS_EXPERIENCE_DIRECTORY } from "@/lib/platform/ops-experience-preview";
import type { OpsExperienceDirectory } from "@/lib/platform/ops-experience-model";

export const dynamic = "force-dynamic";
export default async function OperationsCirclesPage({
  searchParams,
}: {
  searchParams: Promise<{ memberId?: string | string[]; circleId?: string | string[]; memberQuery?: string | string[]; memberPage?: string | string[] }>;
}) {
  const parameters = await searchParams;
  const initialMemberId = typeof parameters.memberId === "string" ? parameters.memberId : undefined;
  const initialCircleId = typeof parameters.circleId === "string" ? parameters.circleId : undefined;
  const memberQuery = typeof parameters.memberQuery === "string" ? parameters.memberQuery.trim().slice(0, 120) : "";
  const requestedMemberPage = typeof parameters.memberPage === "string" ? Number(parameters.memberPage) : 1;
  const context = await getOperatorPageContext();
  if (context.state === "signed_out") redirect("/ops/access");
  if (context.state === "denied") return <PlatformUnavailable reason="operator_access" />;
  if (!context.dashboard) return <PlatformUnavailable accessHref="/ops/access" />;

  let circles: OpsCircleSummary[] | undefined;
  let managementOptions: OpsCircleManagementOptions | undefined;
  let placementMembers = context.dashboard.members;
  let candidateTotal = context.dashboard.unassignedMembers;
  let candidatePage = 1;
  let candidatePageCount = 1;
  let pinnedMemberId: string | undefined;
  let assignments: OpsCircleMemberAssignment[] | undefined;
  let communicationCircles: OpsCircleCommunicationItem[] | undefined =
    context.state === "preview" ? PREVIEW_OPS_CIRCLE_COMMUNICATIONS : undefined;
  let meetingDirectory: OpsExperienceDirectory | null = context.state === "preview" ? PREVIEW_OPS_EXPERIENCE_DIRECTORY : null;
  if (context.state === "preview") {
    circles = PREVIEW_OPS_CIRCLES;
    managementOptions = PREVIEW_OPS_CIRCLE_MANAGEMENT;
    // Static preview fixtures only; connected rosters always resolve exact Circle IDs below.
    assignments = circles.flatMap((circle) => context.dashboard!.members.filter((member) => member.circleName === circle.name).map((member) => ({
      ...member, assignmentId: `preview-assignment-${member.memberId}`, assignedAt: "2026-08-01T00:00:00.000Z", circleId: circle.id,
    })));
    circles = circles.map((circle) => ({ ...circle, activeMembers: assignments!.filter((assignment) => assignment.circleId === circle.id).length }));
    placementMembers = context.dashboard.members.filter((member) => memberQuery ? `${member.name} ${member.email}`.toLowerCase().includes(memberQuery.toLowerCase()) : !member.circleName);
    candidateTotal = placementMembers.length;
    const selectedMember = context.dashboard.members.find((member) => member.memberId === initialMemberId);
    if (selectedMember && !placementMembers.some((member) => member.memberId === selectedMember.memberId)) {
      placementMembers = [...placementMembers, selectedMember];
      pinnedMemberId = selectedMember.memberId;
    }
  }
  if (context.role === "ops_admin" && context.viewer) {
    try {
      const [circleRows, options, roster, directory] = await Promise.all([
        getOpsCircleSummaries(context.viewer.authUserId),
        getOpsCircleManagementOptions(context.viewer.authUserId),
        getOpsCircleMemberAssignments(context.viewer.authUserId),
        // Search should find people, not silently hide them because they need setup or already have a Circle.
        getOperatorMemberDirectoryPage(context.viewer.authUserId, { filter: memberQuery ? "all" : "unassigned", query: memberQuery, page: requestedMemberPage }),
      ]);
      if (!directory) throw new Error("Member directory unavailable");
      circles = circleRows;
      managementOptions = options;
      assignments = roster;
      placementMembers = directory.members;
      candidateTotal = directory.totalResults;
      candidatePage = directory.page;
      candidatePageCount = directory.pageCount;
      if (initialMemberId && !placementMembers.some((member) => member.memberId === initialMemberId)) {
        const selectedDirectory = await getOperatorMemberDirectoryPage(context.viewer.authUserId, { memberId: initialMemberId });
        const selectedMember = selectedDirectory?.members.find((member) => member.memberId === initialMemberId);
        if (selectedMember) {
          placementMembers = [...placementMembers, selectedMember];
          pinnedMemberId = selectedMember.memberId;
        }
      }
    } catch (error) {
      circles = undefined;
      assignments = undefined;
      managementOptions = undefined;
      console.error("Operations Circle administration could not be loaded", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  if (context.viewer) {
    try {
      communicationCircles = await getOpsCircleCommunicationDirectory(
        context.viewer.authUserId,
      );
    } catch (error) {
      console.error("Operations Circle communications could not be loaded", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
    if (initialCircleId || context.role !== "ops_admin") {
      try {
        meetingDirectory = await getOpsExperienceManagementDirectory(context.viewer.authUserId);
      } catch (error) {
        console.error("Operations Circle meetings could not be loaded", {
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
  }

  if (context.role === "ops_admin") {
    if (!circles || !assignments || !managementOptions) return <PlatformUnavailable accessHref="/ops/access" />;
    const selectedCircle = circles.find((circle) => circle.id === initialCircleId);
    return <OperatorPageFrame title="Circles">
      <OperatorCirclesManager
        key={`${initialMemberId ?? ""}:${memberQuery}`}
        initialCircles={circles}
        initialAssignments={assignments}
        candidates={placementMembers}
        candidateTotal={candidateTotal}
        candidatePage={candidatePage}
        candidatePageCount={candidatePageCount}
        pinnedMemberId={pinnedMemberId}
        initialMemberId={initialMemberId}
        initialCircleId={initialCircleId}
        memberQuery={memberQuery}
        preview={context.state === "preview"}
        shaper={selectedCircle ? <OpsCircleManagementActions section="shaper" initialCircleId={initialCircleId} initialCircles={circles} resources={managementOptions.resources} shapers={managementOptions.shapers} preview={context.state === "preview"} /> : null}
        communications={selectedCircle ? <OperatorCircleCommunicationPanel
          circle={selectedCircle}
          communication={communicationCircles?.find((item) => item.id === selectedCircle.id)}
          directory={meetingDirectory}
          preview={context.state === "preview"}
        /> : null}
      >
        <OpsCircleManagementActions section="resources" initialCircleId={initialCircleId} initialCircles={circles} resources={managementOptions.resources} shapers={managementOptions.shapers} preview={context.state === "preview"} />
      </OperatorCirclesManager>
    </OperatorPageFrame>;
  }

  if (!communicationCircles) return <PlatformUnavailable accessHref="/ops/access" />;
  const visibleCircles = initialCircleId ? communicationCircles.filter((circle) => circle.id === initialCircleId) : communicationCircles;
  return <OperatorPageFrame title="Circles">
    {!visibleCircles.length ? <p className="text-sm text-black/65">{initialCircleId ? "This Circle is not available to your account. Ask an Administrator to check your Circle access." : "No Circles are assigned to you yet. Ask an Administrator to assign the Circles you help manage."}</p> : null}
    <div className="grid gap-6">{visibleCircles.map((circle) => <article key={circle.id} id={`circle-${circle.id}`} className="rounded-[4px] bg-black/[0.025] p-5 sm:p-6">
      <header className="mb-5 flex flex-wrap items-center gap-4"><h2 className="font-[var(--font-display)] text-3xl">{circle.name}</h2><StateLabel state={circle.status} /><p className="text-sm text-black/60">{circle.activeMembers}/{circle.capacity} members</p></header>
      <section id={initialCircleId ? "circle-communications" : `circle-communications-${circle.id}`} aria-label={`${circle.name} chat and meetings`} className="scroll-mt-28">
        <OperatorCircleCommunicationPanel circle={circle} communication={circle} directory={meetingDirectory} />
      </section>
    </article>)}</div>
  </OperatorPageFrame>;
}
