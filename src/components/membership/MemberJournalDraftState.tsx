"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { JournalKind, JournalMedia } from "@/lib/membership/journal-model";

export type JournalDraft = {
  kind: JournalKind;
  title: string;
  body: string;
  eventYear: string;
  eventMonth: string;
  eventDay: string;
  includeOnTimeline: boolean;
  files: File[];
  keptMedia: JournalMedia[];
  editingId: string | null;
  editingVersion: string | null;
  attempted: boolean;
  draftId: string;
  uploadIds: Array<[File, string]>;
};
export type JournalDraftCheckpoint = JournalDraft & { wasPending: boolean };

type StoredDraft = { writer: symbol; draft: JournalDraftCheckpoint };

export function copyJournalDraft<T extends JournalDraft>(draft: T): T {
  // File bytes are immutable; arrays, media metadata and retry pairs are not.
  // Object URLs belong to the mounted composer and are rebuilt on restore.
  return { ...draft, files: [...draft.files], keptMedia: draft.keptMedia.map(media => ({ ...media })), uploadIds: draft.uploadIds.map(([file, id]): [File, string] => [file, id]) };
}

/** A single private draft lives only for this verified member-layout instance. */
export function createJournalDraftStore(ownerId?: string) {
  let stored: StoredDraft | null = null;
  return {
    ownerId,
    read(): StoredDraft | null {
      return ownerId && stored ? { writer: stored.writer, draft: copyJournalDraft(stored.draft) } : null;
    },
    write(writer: symbol, draft: JournalDraftCheckpoint) {
      if (ownerId) stored = { writer, draft: copyJournalDraft(draft) };
    },
    clear(writer: symbol) {
      // A disappearing page must never clear a newer page's checkpoint.
      if (stored?.writer === writer) stored = null;
    },
  };
}

const JournalDraftContext = createContext<ReturnType<typeof createJournalDraftStore> | null>(null);

export default function MemberJournalDraftState({ ownerId, temporarilyUnavailable = false, children }: {
  ownerId?: string;
  temporarilyUnavailable?: boolean;
  children: ReactNode;
}) {
  const [scope, setScope] = useState(() => ({ ownerId, store: createJournalDraftStore(ownerId) }));
  const verifiedOwner = ownerId ?? (temporarilyUnavailable ? scope.ownerId : undefined);
  let current = scope;
  if (verifiedOwner !== scope.ownerId) {
    current = { ownerId: verifiedOwner, store: createJournalDraftStore(verifiedOwner) };
    setScope(current);
  }
  // A temporary outage keeps the existing form mounted. A verified account
  // change remounts it, so an old form cannot be checkpointed into a new owner.
  // Old callbacks retain only their abandoned store, never the current one.
  return <JournalDraftContext.Provider key={current.ownerId ?? "unverified"} value={current.store}>{children}</JournalDraftContext.Provider>;
}

export function useJournalDraftStore() {
  return useContext(JournalDraftContext);
}
