import Link from "next/link";

import {
  OperatorAcademyEditorForm,
  OperatorAcademyResourceStateActions,
} from "@/components/platform/OperatorAcademyActions";
import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import StateLabel from "@/components/platform/StateLabel";
import type { OpsAcademyEditorData } from "@/lib/platform/ops-academy-model";

export default function OperatorAcademyEditor({ editor }: { editor: OpsAcademyEditorData }) {
  const resource = editor.resource;
  return (
    <OperatorPageFrame title={`Academy / ${resource.title}`}>
      <Link className="inline-flex min-h-11 items-center gap-2 text-xs uppercase tracking-[0.1em] text-black/48 hover:text-black" href="/ops/academy">
        <span aria-hidden="true">←</span> Academy
      </Link>

      <header className="mt-3 grid gap-6 rounded-[4px] bg-[#080605] px-6 py-7 text-[var(--color-bone)] sm:px-8 sm:py-9 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-white/48">
            <StateLabel state={resource.status} />
            <span>Live v{resource.currentVersion ?? "—"}</span>
            <span>Latest v{resource.latestVersion}</span>
            {resource.hasUnpublishedChanges ? <span className="text-[var(--color-highlight)]">Draft changes waiting</span> : null}
          </div>
          <h1 className="mt-5 max-w-[18ch] font-[var(--font-display)] text-[clamp(2.8rem,7vw,6.5rem)] leading-[0.82] tracking-[-0.055em]">{resource.title}</h1>
        </div>
        {editor.canManage ? (
          <OperatorAcademyResourceStateActions
            resourceId={resource.resourceId}
            revision={resource.revision}
            status={resource.status}
          />
        ) : null}
      </header>

      <section aria-label="Lesson editor" className="mt-7 rounded-[4px] bg-black/[0.03] p-5 sm:p-7">
        <OperatorAcademyEditorForm options={editor.options} resource={resource} />
      </section>

      <aside className="mt-5 rounded-[4px] bg-[var(--color-shop)]/60 px-5 py-5 text-sm leading-relaxed text-black/62 sm:px-7">
        Saving creates a new immutable draft version. Members keep seeing the current live version until Publish is chosen.
      </aside>
    </OperatorPageFrame>
  );
}
