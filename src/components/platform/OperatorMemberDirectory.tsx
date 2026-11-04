import Link from "next/link";

import OperatorMemberDirectoryControls from "@/components/platform/OperatorMemberDirectoryControls";
import OperatorProgress from "@/components/platform/OperatorProgress";
import OperatorMemberAvatar from "@/components/platform/OperatorMemberAvatar";
import OperatorMemberCheckpoints from "@/components/platform/OperatorMemberCheckpoints";
import StateLabel from "@/components/platform/StateLabel";
import type { OperatorMemberSummary } from "@/lib/platform/model";
import { guidanceForMemberSummary } from "@/lib/platform/operator-member-guidance";
import { operatorMemberJourney } from "@/lib/membership/operator-registration-progress";
import type {
  OperatorMemberDirectoryPage,
} from "@/lib/platform/repository";

type DirectoryProps = {
  directory: OperatorMemberDirectoryPage;
};

type LegacyProps = {
  members: OperatorMemberSummary[];
};

function normalizedDirectory(
  props: DirectoryProps | LegacyProps,
): OperatorMemberDirectoryPage {
  if ("directory" in props) return props.directory;
  return {
    filter: "all",
    members: props.members,
    page: 1,
    pageCount: 1,
    pageSize: Math.max(1, props.members.length),
    query: "",
    totalResults: props.members.length,
  };
}

function directoryHref(
  directory: OperatorMemberDirectoryPage,
): string {
  const params = new URLSearchParams();
  if (directory.query) params.set("q", directory.query);
  if (directory.filter !== "all") params.set("filter", directory.filter);
  if (directory.sort && directory.sort !== "alphabetical") params.set("sort", directory.sort);
  if (directory.archive && directory.archive !== "current") params.set("archive", directory.archive);
  const search = params.toString();
  return search ? `/ops/members?${search}` : "/ops/members";
}

export default function OperatorMemberDirectory(props: DirectoryProps | LegacyProps) {
  const directory = normalizedDirectory(props);
  const hasRefinement = Boolean(directory.query || directory.filter !== "all");
  const clearHref = directoryHref({ ...directory, query: "", filter: "all" });

  return (
    <section className="mt-2" aria-labelledby="member-directory-heading">
      <OperatorMemberDirectoryControls directory={directory} />

      <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs text-[color:var(--operator-muted)]">
        <h2 className="sr-only" id="member-directory-heading">Member directory</h2>
        <div className="flex items-center gap-5">
          <span>
            {directory.totalResults === 0
              ? "No matches"
              : `${directory.totalResults} ${directory.totalResults === 1 ? "member" : "members"} · all on one page`}
          </span>
          {hasRefinement ? (
            <Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-[color:var(--operator-ink)]" href={clearHref}>
              Clear search
            </Link>
          ) : null}
        </div>
        {directory.sort === "status" ? <span>Most completed boxes first</span> : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {directory.members.map((member) => {
          const next = guidanceForMemberSummary(member);
          const registration = member.registration ? operatorMemberJourney(member.registration) : null;
          const registrationNext = registration && registration.next.key !== "complete" && ["active", "invited"].includes(member.accountState)
            && !["membership-ended", "paused", "cancellation", "admission-review", "state-review"].includes(next.key);
          return (
          <Link
            className="operator-bento-card grid grid-cols-2 content-start gap-3 transition-colors hover:bg-[var(--operator-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--operator-focus)]"
            href={`/ops/members/${member.memberId}?returnTo=${encodeURIComponent(directoryHref(directory))}`}
            aria-label={`Open ${member.name}’s member record`}
            key={member.memberId}
          >
            <div className="col-span-2 flex min-w-0 items-center gap-3">
              <OperatorMemberAvatar memberId={member.memberId} className="h-11 w-11" />
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold leading-tight">
                  {member.name}
                </h3>
                {member.archivedAt ? <span className="mt-1 inline-block text-xs font-semibold text-[color:var(--operator-muted)]">Archived</span> : null}
                {member.email ? <p className="mt-1 truncate text-xs text-[color:var(--operator-muted)]">{member.email}</p> : null}
              </div>
            </div>
            <div className="text-sm leading-relaxed text-[color:var(--operator-muted)]">
              <span className="operator-compact-label mb-1 block text-[color:var(--operator-muted)]">Circle + Block</span>
              <p>{member.circleName ?? "No Circle"}</p>
              {member.blockName ? <p className="text-[color:var(--operator-muted)]">{member.blockName}</p> : null}
            </div>
            <div>
              <span className="operator-compact-label mb-1 block text-[color:var(--operator-muted)]">{registration ? "Membership" : "Billing"}</span>
              {!registration ? <StateLabel state={member.billingState} /> : null}
              <p className="mt-2 text-xs tabular-nums text-[color:var(--operator-muted)]">Foundations {member.foundationsProgress}%</p>
              <div className="mt-2"><OperatorProgress label={`${member.name} Foundations`} value={member.foundationsProgress} /></div>
            </div>
            <div className="col-span-2 border-t border-[color:var(--operator-ink)]/10 pt-3"><OperatorMemberCheckpoints journey={registration} compact /></div>
            <p className="col-span-2 text-xs leading-relaxed text-[color:var(--operator-muted)]">
              <span className="mb-1 block text-xs font-semibold text-[color:var(--operator-muted)]">{registrationNext ? `Next · ${registration.next.actor}` : `${next.status} · ${next.actor}`}</span>
              {registrationNext ? registration.next.label : next.title}
              {registration?.attention ? <span className="mt-2 block text-[var(--operator-danger)]">Attention: {registration.attention}</span> : null}
              <span className="mt-2 flex min-h-11 items-center font-semibold text-[color:var(--operator-ink)]">Open member record <span aria-hidden="true">→</span></span>
            </p>
          </Link>
          );
        })}
        {directory.members.length === 0 ? (
          <p className="col-span-full py-5 text-sm text-[color:var(--operator-muted)]">
            No members match this search. Try a name, email, Circle, or Block.
          </p>
        ) : null}
      </div>

    </section>
  );
}
