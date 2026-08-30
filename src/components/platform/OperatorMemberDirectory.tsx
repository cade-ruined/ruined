import Link from "next/link";

import OperatorProgress from "@/components/platform/OperatorProgress";
import StateLabel from "@/components/platform/StateLabel";
import {
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
  OPERATOR_PRIMARY_ACTION_CLASS,
} from "@/components/platform/operatorStyles";
import type { OperatorMemberSummary } from "@/lib/platform/model";
import type {
  OperatorMemberDirectoryFilter,
  OperatorMemberDirectoryPage,
} from "@/lib/platform/repository";

const FILTERS: Array<{ label: string; value: OperatorMemberDirectoryFilter }> = [
  { label: "All visible members", value: "all" },
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
        className="grid gap-5 rounded-[4px] bg-[var(--color-surface)] p-5 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.4fr)_auto] lg:items-end sm:p-6"
        method="get"
      >
        <label className="grid gap-2">
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Search</span>
          <input
            className={`${OPERATOR_FIELD_CLASS} mt-0`}
            defaultValue={directory.query}
            maxLength={120}
            name="q"
            placeholder="Name, email, Circle, or Block"
            type="search"
          />
        </label>
        <label className="grid gap-2">
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Show</span>
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
        <button
          className={OPERATOR_PRIMARY_ACTION_CLASS}
          type="submit"
        >
          Find members
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 py-5 text-sm text-black/45">
        <h2 className="sr-only" id="member-directory-heading">Member directory</h2>
        <div className="flex items-center gap-5">
          <span>
            {directory.totalResults === 0
              ? "No matches"
              : `${firstResult}–${lastResult} of ${directory.totalResults}`}
          </span>
          {hasRefinement ? (
            <Link className="underline underline-offset-4 hover:text-black" href="/ops/members">
              Clear search
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        {directory.members.map((member) => (
          <Link
            className="grid gap-4 rounded-[4px] bg-black/[0.025] px-4 py-4 transition-[background-color,transform] hover:-translate-y-px hover:bg-black/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black xl:grid-cols-[minmax(13rem,1.2fr)_minmax(10rem,0.8fr)_10rem_minmax(11rem,1fr)] xl:items-center xl:px-5"
            href={`/ops/members/${member.memberId}`}
            key={member.memberId}
          >
            <div className="min-w-0">
              <h3 className="truncate font-[var(--font-display)] text-xl leading-none">
                {member.name}
              </h3>
              {member.email ? <p className="mt-2 truncate text-sm text-black/50">{member.email}</p> : null}
            </div>
            <div className="text-sm leading-relaxed text-black/62">
              <span className="mb-1 block text-[0.62rem] font-medium uppercase tracking-[0.12em] text-black/38 xl:sr-only">Circle + Block</span>
              <p>{member.circleName ?? "No Circle"}</p>
              <p className="text-black/40">{member.blockName ?? "No Block"}</p>
            </div>
            <div>
              <span className="mb-2 block text-[0.62rem] font-medium uppercase tracking-[0.12em] text-black/38 xl:sr-only">Membership</span>
              <StateLabel state={member.billingState} />
              <p className="mt-3 text-xs tabular-nums text-black/45">Foundations {member.foundationsProgress}%</p>
              <div className="mt-2"><OperatorProgress label={`${member.name} Foundations`} value={member.foundationsProgress} /></div>
            </div>
            <p className="text-sm leading-relaxed text-black/58">
              <span className="mb-1 block text-[0.62rem] font-medium uppercase tracking-[0.12em] text-black/38 xl:sr-only">Next action</span>
              {member.nextAction} →
            </p>
          </Link>
        ))}
        {directory.members.length === 0 ? (
          <p className="py-10 text-sm text-black/50">
            No members match this search. Try a name, email, Circle, or Block.
          </p>
        ) : null}
      </div>

      {directory.pageCount > 1 ? (
        <nav
          aria-label="Member directory pages"
          className="flex items-center justify-between py-5 text-[0.66rem] font-medium uppercase tracking-[0.16em]"
        >
          {directory.page > 1 ? (
            <Link
              className="underline decoration-black/35 underline-offset-4 hover:decoration-black"
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
              className="underline decoration-black/35 underline-offset-4 hover:decoration-black"
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
