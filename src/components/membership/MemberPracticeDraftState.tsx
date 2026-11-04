"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { PracticeAction, PracticeCourse, PracticeTimeFields, PracticeTimelineDraft } from "@/lib/practice/model";

export type PracticeWork = "timeline" | "letter" | "time";
export type PracticeDrafts = { timeline: PracticeTimelineDraft; letter: { body: string }; time: PracticeTimeFields };
export type PracticeDraftCheckpoint = {
  drafts: PracticeDrafts;
  saved: Record<PracticeWork, string>;
  revision: string;
  course: PracticeCourse;
  step: number;
  yearInput: string;
  failed: { request: PracticeAction; entryIds: string[] } | null;
};

export function createPracticeDraftStore(ownerId?: string) {
  let record: { writer: symbol; draft: PracticeDraftCheckpoint } | null = null;
  return {
    read() { return ownerId && record ? { writer: record.writer, draft: structuredClone(record.draft) } : null; },
    write(writer: symbol, draft: PracticeDraftCheckpoint) { if (ownerId) record = { writer, draft: structuredClone(draft) }; },
    clear(writer: symbol) { if (record?.writer === writer) record = null; },
  };
}

const PracticeDraftContext = createContext<ReturnType<typeof createPracticeDraftStore> | null>(null);

/** Unsaved writing survives member navigation only inside its verified owner's layout. */
export default function MemberPracticeDraftState({ ownerId, temporarilyUnavailable = false, children }: {
  ownerId?: string;
  temporarilyUnavailable?: boolean;
  children: ReactNode;
}) {
  const [scope, setScope] = useState(() => ({ ownerId, store: createPracticeDraftStore(ownerId) }));
  const verifiedOwner = ownerId ?? (temporarilyUnavailable ? scope.ownerId : undefined);
  let current = scope;
  if (verifiedOwner !== scope.ownerId) {
    current = { ownerId: verifiedOwner, store: createPracticeDraftStore(verifiedOwner) };
    setScope(current);
  }
  return <PracticeDraftContext.Provider key={current.ownerId ?? "unverified"} value={current.store}>{children}</PracticeDraftContext.Provider>;
}

export function usePracticeDraftStore() { return useContext(PracticeDraftContext); }
