import type { MemberTimelineSnapshot } from "@/lib/membership/model";
import type { toTimelineSaveEntries } from "./timeline-model";

type TimelineSaveEntry = ReturnType<typeof toTimelineSaveEntries>[number];
type TimelineMutationEntry = Omit<TimelineSaveEntry, "month"> & { month?: number | null };

export class TimelineConflictError extends Error {}
export class TimelineSaveUncertainError extends Error {}

export interface TimelinePersistenceAdapter {
  complete(current: MemberTimelineSnapshot): Promise<MemberTimelineSnapshot>;
  load(current: MemberTimelineSnapshot): Promise<MemberTimelineSnapshot>;
  save(entries: TimelineSaveEntry[], current: MemberTimelineSnapshot): Promise<MemberTimelineSnapshot>;
}

function singleMutation(entries: TimelineSaveEntry[], current: MemberTimelineSnapshot) {
  const existing = new Map(current.entries.map(entry => [entry.id, entry]));
  const seen = new Set<string>();
  const changes: Array<{ action: "upsert"; entry: TimelineMutationEntry } | { action: "delete"; id: string }> = [];
  for (const entry of entries) {
    const payload = {
      id: entry.id, year: entry.year, title: entry.title.trim(), details: entry.details?.trim() || null,
      ...(entry.month === undefined ? {} : { month: entry.month }),
    };
    if (entry.id === null) { changes.push({ action: "upsert", entry: payload }); continue; }
    const saved = existing.get(entry.id);
    if (!saved || seen.has(entry.id)) throw new TimelineConflictError("Load the latest saved events before saving this moment.");
    seen.add(entry.id);
    if (entry.year !== saved.year || (entry.month !== undefined && entry.month !== (saved.month ?? null))
      || entry.title.trim() !== saved.title.trim() || (entry.details?.trim() || null) !== (saved.details?.trim() || null)) {
      changes.push({ action: "upsert", entry: payload });
    }
  }
  for (const entry of current.entries) if (!seen.has(entry.id)) changes.push({ action: "delete", id: entry.id });
  if (changes.length > 1) throw new Error("Save one moment at a time. Your changes have not been sent.");
  return changes[0] ?? null;
}

export function createTimelinePersistenceAdapter({ preview, writable }: {
  preview: boolean;
  writable: boolean;
}): TimelinePersistenceAdapter {
  if (preview) {
    let lastPosition = 0;
    return {
      async complete(current) {
        return { ...current, completedAt: new Date().toISOString() };
      },
      async load(current) { return current; },
      async save(entries, current) {
        const mutation = singleMutation(entries, current);
        if (!mutation) return current;
        lastPosition = current.entries.reduce((maximum, entry) => Math.max(maximum, entry.position), lastPosition);
        const savedEntries = mutation.action === "delete"
          ? current.entries.filter(entry => entry.id !== mutation.id)
          : mutation.entry.id
            ? current.entries.map(entry => entry.id === mutation.entry.id ? {
              ...entry, ...mutation.entry, id: entry.id, position: entry.position,
              month: mutation.entry.month === undefined ? entry.month ?? null : mutation.entry.month,
            } : entry)
            : [...current.entries, {
              ...mutation.entry, id: `preview-${crypto.randomUUID()}`, month: mutation.entry.month ?? null, position: ++lastPosition,
            }];
        return {
          ...current,
          revision: String(Number(current.revision) + 1),
          entries: savedEntries.sort((left, right) => left.year - right.year
            || (left.month ?? 13) - (right.month ?? 13) || left.position - right.position),
        };
      },
    };
  }

  async function readTimeline(response: Response) {
    const payload = (await response.json()) as { error?: string; timeline?: MemberTimelineSnapshot };
    if (response.status === 409) {
      throw new TimelineConflictError(payload.error || "Your Timeline changed in another tab. Load the latest saved events before trying again.");
    }
    if (!response.ok || !payload.timeline) {
      throw new Error(payload.error || "Your Timeline could not be loaded or saved.");
    }
    return payload.timeline;
  }

  return {
    async complete(current) {
      if (!writable) throw new Error("This Timeline is read-only.");
      const response = await fetch("/api/my/timeline", {
        body: JSON.stringify({ action: "complete" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        requirements?: { timeline?: { completedAt?: string | null } };
      };
      const completedAt = payload.requirements?.timeline?.completedAt ?? null;
      if (!response.ok || !completedAt) {
        throw new Error(payload.error || "Timeline completion could not be saved.");
      }
      return { ...current, completedAt };
    },
    async load() {
      return readTimeline(await fetch("/api/my/timeline", { cache: "no-store" }));
    },
    async save(entries, current) {
      if (!writable) throw new Error("This Timeline is read-only.");
      const mutation = singleMutation(entries, current);
      if (!mutation) return current;
      let response: Response;
      try {
        response = await fetch("/api/my/timeline", {
          body: JSON.stringify({ ...mutation, expectedRevision: current.revision }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        if (response.status >= 500) throw new Error("Unconfirmed response");
      } catch {
        throw new TimelineSaveUncertainError("We couldn't confirm the save. Load the latest events and review them before saving this draft again.");
      }
      try {
        return await readTimeline(response);
      } catch (error) {
        // A successful response with unreadable data is also ambiguous: the
        // write may have committed, so never encourage a blind duplicate save.
        if (response.ok) throw new TimelineSaveUncertainError("We couldn't confirm the save. Load the latest events and review them before saving this draft again.");
        throw error;
      }
    },
  };
}
