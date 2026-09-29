import type { LeadershipDirectory } from "@/lib/platform/leadership-model";
const libby = "11111111-1111-4111-8111-111111111111", tyler = "22222222-2222-4222-8222-222222222222", mitch = "33333333-3333-4333-8333-333333333333", cherry = "44444444-4444-4444-8444-444444444444", circle = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PREVIEW_LEADERSHIP: LeadershipDirectory = {
  canConfigure: true, capabilities: ["circle_placement", "circle_exception", "supporter_readiness", "reimbursements"],
  grants: [
    { id: "preview-libby-placement", authUserId: libby, name: "Libby", capability: "circle_placement" },
    { id: "preview-libby-reimbursements", authUserId: libby, name: "Libby", capability: "reimbursements" },
    { id: "preview-tyler-readiness", authUserId: tyler, name: "Tyler", capability: "supporter_readiness" },
    { id: "preview-mitch-readiness", authUserId: mitch, name: "Mitch", capability: "supporter_readiness" },
    { id: "preview-tyler-exception", authUserId: tyler, name: "Tyler", capability: "circle_exception" },
    { id: "preview-mitch-exception", authUserId: mitch, name: "Mitch", capability: "circle_exception" },
  ],
  people: [
    { authUserId: libby, name: "Libby", email: "libby@example.test", operator: true, circleIds: [] },
    { authUserId: tyler, name: "Tyler", email: "tyler@example.test", operator: true, circleIds: [circle] },
    { authUserId: mitch, name: "Mitch", email: "mitch@example.test", operator: true, circleIds: [] },
    { authUserId: cherry, name: "Cherry Hill", email: "cherry@example.test", operator: false, circleIds: [circle] },
  ],
  circles: [{ id: circle, name: "The First Circle" }],
  readiness: [{ id: "preview-ready", authUserId: cherry, circleId: circle, approvedAt: "2026-09-01T18:00:00Z", reason: "Observed, co-facilitated, led, and debriefed with the team." }],
  services: [{ id: "1", authUserId: cherry, name: "Cherry Hill", circleId: circle, circleName: "The First Circle", startedAt: "2026-09-01T18:00:00Z", endedAt: null, temporary: false, reason: "Ready to serve this Circle." }],
  reimbursements: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", assignmentId: "1", name: "Cherry Hill", circleName: "The First Circle", periodStart: "2026-09-01", periodEnd: "2026-09-15", amountMinor: 49900, currency: "USD", status: "pending", reason: "Membership payment during active service; submitted for discretionary review.", decisionReason: null, reference: null, processedAt: null }],
};
