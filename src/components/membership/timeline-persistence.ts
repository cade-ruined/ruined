import type { MemberTimelineSnapshot } from "@/lib/membership/model";
import type { toTimelineSaveEntries } from "./timeline-model";

type TimelineSaveEntry = ReturnType<typeof toTimelineSaveEntries>[number];

export class TimelineConflictError extends Error {}
export class TimelineSaveUncertainError extends Error {}

export interface TimelinePersistenceAdapter {
  complete(current: MemberTimelineSnapshot): Promise<MemberTimelineSnapshot>;
  load(current: MemberTimelineSnapshot): Promise<MemberTimelineSnapshot>;
  save(entries: TimelineSaveEntry[], current: MemberTimelineSnapshot): Promise<MemberTimelineSnapshot>;
}

export function createTimelinePersistenceAdapter({ preview, writable }: {
  preview: boolean;
  writable: boolean;
}): TimelinePersistenceAdapter {
  if (preview) {
    return {
      async complete(current) {
        return { ...current, completedAt: new Date().toISOString() };
      },
      async load(current) { return current; },
      async save(entries, current) {
        return {
          ...current,
          revision: String(Number(current.revision) + 1),
          entries: entries.map((entry, index) => ({
            details: entry.details,
            id: entry.id ?? `preview-${crypto.randomUUID()}`,
            position: index + 1,
            title: entry.title,
            year: entry.year,
          })),
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
      let response: Response;
      try {
        response = await fetch("/api/my/timeline", {
          body: JSON.stringify({ action: "save", entries, expectedRevision: current.revision }),
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
