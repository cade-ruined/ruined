import Link from "next/link";

import StateLabel from "@/components/platform/StateLabel";
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
    <section className="mt-14" aria-labelledby="member-directory-heading">
      <form
        action="/ops/members"
        className="grid gap-4 border-y border-black/25 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.4fr)_auto] lg:items-end"
        method="get"
      >
        <label className="grid gap-2 text-[0.64rem] font-medium uppercase tracking-[0.16em] text-black/50">
          Search the full roster
          <input
            className="min-h-12 border border-black/35 bg-transparent px-4 text-base normal-case tracking-normal text-black outline-none placeholder:text-black/35 focus:border-black"
            defaultValue={directory.query}
            maxLength={120}
            name="q"
            placeholder="Name, email, Circle, or Block"
            type="search"
          />
        </label>
        <label className="grid gap-2 text-[0.64rem] font-medium uppercase tracking-[0.16em] text-black/50">
          Show
          <select
            className="min-h-12 border border-black/35 bg-transparent px-4 text-sm text-black outline-none focus:border-black"
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
          className="min-h-12 border border-black bg-black px-6 text-[0.66rem] font-medium uppercase tracking-[0.16em] text-[var(--color-bone)] transition-colors hover:bg-[var(--color-poster)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
          type="submit"
        >
          Find members
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/15 py-4 text-[0.66rem] uppercase tracking-[0.14em] text-black/45">
        <h2 className="ui-heading text-[0.66rem] uppercase tracking-[0.14em]" id="member-directory-heading">
          Member directory
        </h2>
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

      <div className="divide-y divide-black/15">
        {directory.members.map((member) => (
          <article
            className="grid gap-4 py-5 md:grid-cols-[minmax(13rem,1.2fr)_minmax(10rem,0.8fr)_8rem_minmax(11rem,1fr)] md:items-center"
            key={member.memberId}
          >
            <div className="min-w-0">
              <h3 className="ui-heading truncate text-base font-semibold">{member.name}</h3>
              <p className="mt-1 truncate text-sm text-black/50">{member.email}</p>
            </div>
            <div className="text-sm leading-relaxed text-black/62">
              <p>{member.circleName ?? "No Circle"}</p>
              <p className="text-black/40">{member.blockName ?? "No Block"}</p>
            </div>
            <div>
              <StateLabel state={member.billingState} />
              <p className="mt-2 text-xs text-black/45">Foundations {member.foundationsProgress}%</p>
            </div>
            <p className="text-sm leading-relaxed text-black/58">{member.nextAction}</p>
          </article>
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
          className="flex items-center justify-between border-t border-black/25 py-5 text-[0.66rem] font-medium uppercase tracking-[0.16em]"
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
