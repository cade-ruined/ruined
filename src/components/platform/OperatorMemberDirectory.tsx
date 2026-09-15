import Link from "next/link";

import OperatorProgress from "@/components/platform/OperatorProgress";
import OperatorMemberAvatar from "@/components/platform/OperatorMemberAvatar";
import StateLabel from "@/components/platform/StateLabel";
import {
  OPERATOR_FIELD_CLASS,
  OPERATOR_BUTTON_CLASS,
} from "@/components/platform/operatorStyles";
import type { OperatorMemberSummary } from "@/lib/platform/model";
import { guidanceForMemberSummary } from "@/lib/platform/operator-member-guidance";
import type {
  OperatorMemberDirectoryFilter,
  OperatorMemberDirectoryPage,
} from "@/lib/platform/repository";

const FILTERS: Array<{ label: string; value: OperatorMemberDirectoryFilter }> = [
  { label: "All members", value: "all" },
  { label: "Needs attention", value: "attention" },
  { label: "Moving through Foundations", value: "foundations" },
  { label: "Without a Circle", value: "unassigned" },
];

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
  page: number,
): string {
  const params = new URLSearchParams();
  if (directory.query) params.set("q", directory.query);
  if (directory.filter !== "all") params.set("filter", directory.filter);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/ops/members?${search}` : "/ops/members";
}

export default function OperatorMemberDirectory(props: DirectoryProps | LegacyProps) {
  const directory = normalizedDirectory(props);
  const firstResult = directory.totalResults === 0
    ? 0
    : (directory.page - 1) * directory.pageSize + 1;
  const lastResult = directory.totalResults === 0
    ? 0
    : firstResult + directory.members.length - 1;
  const hasRefinement = Boolean(directory.query || directory.filter !== "all");

  return (
    <section className="mt-2" aria-labelledby="member-directory-heading">
      <form
        action="/ops/members"
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(10rem,0.5fr)]"
        method="get"
      >
        <label className="min-w-0">
          <span className="sr-only">Search members</span>
          <input
            className={`${OPERATOR_FIELD_CLASS} mt-0`}
            defaultValue={directory.query}
            maxLength={120}
            name="q"
            placeholder="Name, email, Circle, or Block"
            type="search"
          />
        </label>
        <button
          aria-label="Find members"
          className={OPERATOR_BUTTON_CLASS}
          type="submit"
        >
          Find
        </button>
        <label className="col-span-2 min-w-0 sm:col-span-1">
          <span className="sr-only">Show members</span>
          <select
            className={`${OPERATOR_FIELD_CLASS} mt-0`}
            defaultValue={directory.filter}
            name="filter"
          >
            {FILTERS.map((option) => (
              <option className="bg-[var(--color-bone)]" key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs text-black/45">
        <h2 className="sr-only" id="member-directory-heading">Member directory</h2>
        <div className="flex items-center gap-5">
          <span>
            {directory.totalResults === 0
              ? "No matches"
              : `${firstResult}–${lastResult} of ${directory.totalResults}`}
          </span>
          {hasRefinement ? (
            <Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-black" href="/ops/members">
              Clear search
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {directory.members.map((member) => {
          const next = guidanceForMemberSummary(member);
          return (
          <Link
            className="operator-bento-card grid grid-cols-2 content-start gap-3 transition-colors hover:bg-black/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            href={`/ops/members/${member.memberId}?returnTo=${encodeURIComponent(directoryHref(directory, directory.page))}`}
            aria-label={`Open ${member.name}’s member record`}
            key={member.memberId}
          >
            <div className="col-span-2 flex min-w-0 items-center gap-3">
              <OperatorMemberAvatar memberId={member.memberId} className="h-11 w-11" />
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold leading-tight">
                  {member.name}
                </h3>
                {member.email ? <p className="mt-1 truncate text-xs text-black/50">{member.email}</p> : null}
              </div>
            </div>
            <div className="text-sm leading-relaxed text-black/62">
              <span className="operator-compact-label mb-1 block text-black/50">Circle + Block</span>
              <p>{member.circleName ?? "No Circle"}</p>
              {member.blockName ? <p className="text-black/50">{member.blockName}</p> : null}
            </div>
            <div>
              <span className="operator-compact-label mb-1 block text-black/50">Billing</span>
              <StateLabel state={member.billingState} />
              <p className="mt-2 text-xs tabular-nums text-black/45">Foundations {member.foundationsProgress}%</p>
              <div className="mt-2"><OperatorProgress label={`${member.name} Foundations`} value={member.foundationsProgress} /></div>
            </div>
            <p className="col-span-2 text-xs leading-relaxed text-black/58">
              <span className="mb-1 block text-xs font-semibold text-black/70">{next.status} · {next.actor}</span>
              {next.title}
              <span className="mt-2 flex min-h-11 items-center font-semibold text-black">Open member record <span aria-hidden="true">→</span></span>
            </p>
          </Link>
          );
        })}
        {directory.members.length === 0 ? (
          <p className="col-span-full py-5 text-sm text-black/50">
            No members match this search. Try a name, email, Circle, or Block.
          </p>
        ) : null}
      </div>

      {directory.pageCount > 1 ? (
        <nav
          aria-label="Member directory pages"
          className="flex items-center justify-between py-5 text-sm font-medium"
        >
          {directory.page > 1 ? (
            <Link
              className="inline-flex min-h-11 items-center underline decoration-black/35 underline-offset-4 hover:decoration-black"
              href={directoryHref(directory, directory.page - 1)}
            >
              ← Previous members
            </Link>
          ) : <span />}
          <span className="text-black/45">
            Page {directory.page} of {directory.pageCount}
          </span>
          {directory.page < directory.pageCount ? (
            <Link
              className="inline-flex min-h-11 items-center underline decoration-black/35 underline-offset-4 hover:decoration-black"
              href={directoryHref(directory, directory.page + 1)}
            >
              Next members →
            </Link>
          ) : <span />}
        </nav>
      ) : null}
    </section>
  );
}
