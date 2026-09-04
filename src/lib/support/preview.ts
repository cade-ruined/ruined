import type { SupportTicket } from "@/lib/support/model";

// Illustrative content only. Preview routes never submit or read real support requests.
export const PREVIEW_SUPPORT_TICKETS: SupportTicket[] = [
  {
    id: "80000000-0000-4000-8000-000000000001",
    number: "R-000001",
    subject: "I'd like to join a specific Circle",
    category: "circle",
    status: "in_progress",
    requesterName: "Preview member",
    requesterEmail: "member@example.test",
    createdAt: "2026-09-02T16:00:00Z",
    updatedAt: "2026-09-03T15:00:00Z",
    emailAttentionCount: 1,
    emailDeliveries: [
      { id: "preview-delivery-1", audience: "operator", status: "sent", attempts: 1, first_attempt_at: "2026-09-02T16:00:01Z", created_at: "2026-09-02T16:00:00Z", sent_at: "2026-09-02T16:00:02Z", last_error: null },
      { id: "preview-delivery-2", audience: "member", status: "dead_letter", attempts: 2, first_attempt_at: "2026-09-03T15:00:00Z", created_at: "2026-09-03T15:00:00Z", sent_at: null, last_error: "replay_window_expired" },
    ],
    messages: [
      { id: "preview-message-1", authorType: "member", body: "A friend is in Circle 01. Can you help me check whether there is room to join?", createdAt: "2026-09-02T16:00:00Z" },
      { id: "preview-message-2", authorType: "operator", body: "We're checking the available places with the Shaper. We'll follow up here.", createdAt: "2026-09-03T15:00:00Z" },
    ],
  },
  {
    id: "80000000-0000-4000-8000-000000000002",
    number: "R-000002",
    subject: "Update my shipping address",
    category: "artifacts",
    status: "waiting_on_member",
    requesterName: "Preview member",
    requesterEmail: "member@example.test",
    createdAt: "2026-09-01T18:00:00Z",
    updatedAt: "2026-09-02T18:00:00Z",
    emailAttentionCount: 1,
    emailDeliveries: [
      { id: "preview-delivery-3", audience: "member", status: "dead_letter", attempts: 5, first_attempt_at: "2026-09-02T18:00:00Z", created_at: "2026-09-02T18:00:00Z", sent_at: null, last_error: "not_sent:provider_rejected" },
    ],
    messages: [
      { id: "preview-message-3", authorType: "member", body: "I've moved and need to update the address for my artifact.", createdAt: "2026-09-01T18:00:00Z" },
      { id: "preview-message-4", authorType: "operator", body: "Please update the shipping address on your profile and let us know here when it's saved.", createdAt: "2026-09-02T18:00:00Z" },
    ],
  },
];
