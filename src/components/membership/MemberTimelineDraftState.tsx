"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { TimelineFormValue } from "./timeline-model";

export type TimelineDraftCheckpoint = {
  form: TimelineFormValue;
  baseline: TimelineFormValue;
  editingEntryId: string | null;
  revision: string;
  wasPending: boolean;
};

type StoredDraft = { writer: symbol; draft: TimelineDraftCheckpoint };

function copyDraft(draft: TimelineDraftCheckpoint): TimelineDraftCheckpoint {
  return { ...draft, form: { ...draft.form }, baseline: { ...draft.baseline } };
}

/** A single private draft lives only for this verified member-layout instance. */
export function createTimelineDraftStore(ownerId?: string) {
  let stored: StoredDraft | null = null;
  return {
    read(): StoredDraft | null {
      return ownerId && stored ? { writer: stored.writer, draft: copyDraft(stored.draft) } : null;
    },
    write(writer: symbol, draft: TimelineDraftCheckpoint) {
      if (ownerId) stored = { writer, draft: copyDraft(draft) };
    },
    clear(writer: symbol) {
      // A disappearing page must never clear a newer page's checkpoint.
      if (stored?.writer === writer) stored = null;
    },
  };
}

const TimelineDraftContext = createContext<ReturnType<typeof createTimelineDraftStore> | null>(null);

export default function MemberTimelineDraftState({ ownerId, temporarilyUnavailable = false, children }: {
  ownerId?: string;
  temporarilyUnavailable?: boolean;
  children: ReactNode;
}) {
  const [scope, setScope] = useState(() => ({ ownerId, store: createTimelineDraftStore(ownerId) }));
  const verifiedOwner = ownerId ?? (temporarilyUnavailable ? scope.ownerId : undefined);
  let current = scope;
  if (verifiedOwner !== scope.ownerId) {
    current = { ownerId: verifiedOwner, store: createTimelineDraftStore(verifiedOwner) };
    setScope(current);
  }
  // A temporary outage keeps the existing form mounted. A verified account
  // change remounts it, so an old form cannot be checkpointed into a new owner.
  // Old callbacks retain only their abandoned store, never the current one.
  return <TimelineDraftContext.Provider key={current.ownerId ?? "unverified"} value={current.store}>{children}</TimelineDraftContext.Provider>;
}

export function useTimelineDraftStore() {
  return useContext(TimelineDraftContext);
}
