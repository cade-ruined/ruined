"use client";

import Link from "next/link";
import { useState } from "react";
import OperatorPageFrame from "./OperatorPageFrame";
import StateLabel from "./StateLabel";
import { OPERATOR_FIELD_CLASS, OPERATOR_PRIMARY_ACTION_CLASS } from "./operatorStyles";
import type { OpsSopSnapshot } from "@/lib/platform/ops-sop-model";

function updatedLabel(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Recently updated" : `Updated ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date)}`;
}

export default function OperatorSops({ library, preview = false }: { library: OpsSopSnapshot; preview?: boolean }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("current");
  const categories = [...new Set(library.procedures.map((item) => item.category))].sort((a, b) => a.localeCompare(b));
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const procedures = library.procedures.filter((item) => {
    const matchesStatus = status === "all" || (status === "current" ? item.status !== "archived" : item.status === status);
    const text = `${item.title} ${item.summary} ${item.category} ${item.bodyText}`.toLocaleLowerCase();
    return matchesStatus && (!category || item.category === category) && words.every((word) => text.includes(word));
  });
  const filtering = Boolean(query || category || status !== "current");
  return <OperatorPageFrame title="SOPs">
    <header className="mb-7 flex flex-wrap items-start justify-between gap-5">
      <div className="max-w-xl">
        <p className="text-lg font-semibold tracking-tight">How we do things.</p>
        <p className="mt-2 text-sm leading-relaxed text-[color:var(--operator-muted)]">Standard operating procedures for the Ruined team. Find the process, follow the steps, keep it current.</p>
      </div>
      {library.canManage ? <Link className={OPERATOR_PRIMARY_ACTION_CLASS} href="/ops/sops/new">+ New SOP</Link> : null}
    </header>
    {preview ? <p className="mb-5 border-l-2 border-[var(--color-poster)] pl-3 text-sm text-[color:var(--operator-muted)]">Example procedures for preview. Your live library starts empty.</p> : null}
    <section aria-label="Find a procedure">
      <div className={`grid gap-3 ${library.canManage ? "md:grid-cols-[minmax(0,1fr)_12rem_10rem]" : "sm:grid-cols-[minmax(0,1fr)_12rem]"}`}>
        <label className="min-w-0 text-sm">Search SOPs<input className={OPERATOR_FIELD_CLASS} onChange={(event) => setQuery(event.target.value)} placeholder="Search a title, topic, or step" type="search" value={query} /></label>
        <label className="min-w-0 text-sm">Category<select className={OPERATOR_FIELD_CLASS} value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        {library.canManage ? <label className="min-w-0 text-sm">Status<select className={OPERATOR_FIELD_CLASS} value={status} onChange={(event) => setStatus(event.target.value)}><option value="current">Current SOPs</option><option value="published">Published</option><option value="draft">Drafts</option><option value="archived">Archived</option><option value="all">All SOPs</option></select></label> : null}
      </div>
      <div className="my-4 flex min-h-7 flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-xs text-[color:var(--operator-muted)]">{procedures.length} {procedures.length === 1 ? "procedure" : "procedures"}{category ? ` · ${category}` : ""}</p>
        {filtering ? <button className="min-h-11 text-sm underline underline-offset-4" onClick={() => { setQuery(""); setCategory(""); setStatus("current"); }} type="button">Clear filters</button> : null}
      </div>
      {procedures.length ? <ul className="grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
        {procedures.map((procedure) => <li className="min-w-0" key={procedure.id}>
          <Link className="operator-bento-card flex h-full min-w-0 flex-col gap-4 transition-colors hover:bg-[var(--operator-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2" href={`/ops/sops/${procedure.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-words text-xs font-semibold text-[color:var(--operator-muted)]">{procedure.category}</span><StateLabel state={procedure.status} /></div>
            <div><h2 className="break-words text-xl font-semibold leading-tight tracking-tight">{procedure.title}</h2>{procedure.summary ? <p className="mt-2 line-clamp-3 break-words text-sm leading-relaxed text-[color:var(--operator-muted)]">{procedure.summary}</p> : null}</div>
            <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-[color:var(--operator-ink)]/10 pt-4 text-xs text-[color:var(--operator-muted)]"><span>{updatedLabel(procedure.updatedAt)}<span className="mt-1 block">Revision {procedure.revision}</span></span><span aria-hidden="true" className="text-lg text-[var(--operator-danger)]">↗</span></div>
          </Link>
        </li>)}
      </ul> : <div className="rounded-none border border-dashed border-[color:var(--operator-ink)]/20 bg-[var(--operator-surface)] px-6 py-12 text-center">
        <h2 className="text-xl font-semibold">{filtering ? "No matching procedures." : "A place for the way we work."}</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[color:var(--operator-muted)]">{filtering ? "Try another search or clear your filters." : library.canManage ? "Create your first SOP. Write the steps here or link an existing document, then publish it for the team." : "Published procedures will appear here when an administrator adds them."}</p>
        {!filtering && library.canManage ? <Link className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4" href="/ops/sops/new">Create the first SOP ↗</Link> : null}
      </div>}
    </section>
  </OperatorPageFrame>;
}
