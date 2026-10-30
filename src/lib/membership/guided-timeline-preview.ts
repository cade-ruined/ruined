import type { JournalSnapshot } from "./journal-model";

/** Fictional stories for trying the editor; never inserted into a member account. */
export const GUIDED_TIMELINE_PREVIEW: JournalSnapshot = {
  writable: false, mediaReady: true, hasMore: false, publicUrl: "/profile/preview_member",
  entries: [
    { id: "11111111-1111-4111-8111-111111111111", kind: "text", title: "Starting over somewhere new", body: "I moved to a city where I didn’t know anyone.", eventYear: 2019, eventMonth: 9, eventDay: null, createdAt: "2026-10-29T12:00:00Z", saved: false, media: [], version: "1", visibility: "public", includeOnTimeline: true,
      timelineReflection: { meaning: "Starting over meant I had fallen behind.", belief: "I needed to have everything figured out before I could belong.", presentImpact: "I sometimes wait to feel ready before reaching out.", perspective: "I can begin a relationship before I have the perfect story to tell." } },
    { id: "22222222-2222-4222-8222-222222222222", kind: "text", title: "Saying yes before I felt ready", body: "I shared something I had been working on.", eventYear: 2024, eventMonth: 4, eventDay: null, createdAt: "2026-10-28T12:00:00Z", saved: false, media: [], version: "1", visibility: "private", includeOnTimeline: true,
      timelineReflection: { meaning: "Being seen meant being judged.", belief: "My work needed to be perfect to be worth sharing.", presentImpact: null, perspective: null } },
  ],
};
