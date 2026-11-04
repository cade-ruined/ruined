"use client";

import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS } from "@/components/platform/operatorStyles";
import { OPERATOR_MEMBER_SORTS } from "@/lib/platform/operator-member-directory";
import type { OperatorMemberDirectoryPage } from "@/lib/platform/repository";

export default function OperatorMemberDirectoryControls({ directory }: { directory: OperatorMemberDirectoryPage }) {
  return (
    <form action="/ops/members" method="get" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="min-w-0 sm:col-span-2 xl:col-span-1">
        <label className="operator-compact-label text-[color:var(--operator-muted)]" htmlFor="member-directory-search">Search members</label>
        <span className="mt-1 flex gap-2">
          <input className={`${OPERATOR_FIELD_CLASS} mt-0 min-w-0`} defaultValue={directory.query}
            id="member-directory-search" maxLength={120} name="q" placeholder="Name, email, Circle, or Block" type="search" />
          <button aria-label="Find members" className={OPERATOR_BUTTON_CLASS} type="submit">Find</button>
        </span>
      </div>
      <label className="min-w-0">
        <span className="operator-compact-label text-[color:var(--operator-muted)]">Show members</span>
        <select className={OPERATOR_FIELD_CLASS} defaultValue={directory.filter} name="filter" onChange={event => event.currentTarget.form?.requestSubmit()}>
          <option className="bg-[var(--operator-surface)]" value="all">All members</option>
          <option className="bg-[var(--operator-surface)]" value="attention">Needs attention</option>
          <option className="bg-[var(--operator-surface)]" value="foundations">Moving through Foundations</option>
          <option className="bg-[var(--operator-surface)]" value="unassigned">Without a Circle</option>
        </select>
      </label>
      <label className="min-w-0">
        <span className="operator-compact-label text-[color:var(--operator-muted)]">Sort by</span>
        <select className={OPERATOR_FIELD_CLASS} defaultValue={directory.sort ?? "alphabetical"} name="sort" onChange={event => event.currentTarget.form?.requestSubmit()}>
          {OPERATOR_MEMBER_SORTS.map(option => <option className="bg-[var(--operator-surface)]" key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {directory.canViewArchived ? <label className="min-w-0">
        <span className="operator-compact-label text-[color:var(--operator-muted)]">Records</span>
        <select className={OPERATOR_FIELD_CLASS} defaultValue={directory.archive ?? "current"} name="archive" onChange={event => event.currentTarget.form?.requestSubmit()}>
          <option className="bg-[var(--operator-surface)]" value="current">Current members</option>
          <option className="bg-[var(--operator-surface)]" value="archived">Archived members</option>
          <option className="bg-[var(--operator-surface)]" value="all">Current + archived</option>
        </select>
      </label> : null}
    </form>
  );
}
