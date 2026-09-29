export const LEADERSHIP_RESPONSIBILITIES = ["circle_placement", "circle_exception", "supporter_readiness", "reimbursements"] as const;
export type LeadershipResponsibility = typeof LEADERSHIP_RESPONSIBILITIES[number];
export const LEADERSHIP_LABELS: Record<LeadershipResponsibility, string> = {
  circle_placement: "Routine Circle placement",
  circle_exception: "Circle placement exceptions",
  supporter_readiness: "Supporter readiness and coverage",
  reimbursements: "Reimbursement approval and processing",
};
export type LeadershipCommand =
  | { action: "grant" | "revoke"; authUserId: string; capability: LeadershipResponsibility; reason: string }
  | { action: "ready"; authUserId: string; circleId: string; reason: string }
  | { action: "start"; authUserId: string; circleId: string; temporary: boolean; reason: string }
  | { action: "end"; assignmentId: string; coverAuthUserId: string | null; reason: string }
  | { action: "request_reimbursement"; assignmentId: string; periodStart: string; periodEnd: string; amountMinor: number; currency: string; reason: string }
  | { action: "approve" | "reject"; reimbursementId: string; reason: string }
  | { action: "process"; reimbursementId: string; reference: string; processedAt: string; reason: string };
export type LeadershipPerson = { authUserId: string; name: string; email: string; operator: boolean; circleIds: string[] };
export type LeadershipDirectory = {
  canConfigure: boolean;
  capabilities: LeadershipResponsibility[];
  grants: { id: string; authUserId: string; name: string; capability: LeadershipResponsibility }[];
  people: LeadershipPerson[];
  circles: { id: string; name: string }[];
  readiness: { id: string; authUserId: string; circleId: string; approvedAt: string; reason: string }[];
  services: { id: string; authUserId: string; name: string; circleId: string; circleName: string; startedAt: string; endedAt: string | null; temporary: boolean; reason: string | null }[];
  reimbursements: { id: string; assignmentId: string; name: string; circleName: string; periodStart: string; periodEnd: string; amountMinor: number; currency: string; status: "pending" | "approved" | "rejected" | "processed"; reason: string; decisionReason: string | null; reference: string | null; processedAt: string | null }[];
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function parseLeadershipCommand(input: unknown): LeadershipCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Choose a leadership action.");
  const data = input as Record<string, unknown>;
  const text = (key: string, maximum = 1200) => {
    const value = typeof data[key] === "string" ? data[key].trim() : "";
    if (!value || value.length > maximum) throw new Error(`Enter a valid ${key.replace(/([A-Z])/g, " $1").toLowerCase()}.`);
    return value;
  };
  const uuid = (key: string) => { const value = text(key, 36); if (!UUID.test(value)) throw new Error("Choose a valid account, Circle, or record."); return value.toLowerCase(); };
  const assignment = () => { const value = text("assignmentId", 20); if (!/^\d+$/.test(value)) throw new Error("Choose a service record."); return value; };
  const date = (key: string) => { const value = text(key, 10); if (!DATE.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("Enter a valid date."); return value; };
  const reason = text("reason");
  switch (data.action) {
    case "grant": case "revoke": {
      const capability = text("capability");
      if (!LEADERSHIP_RESPONSIBILITIES.includes(capability as LeadershipResponsibility)) throw new Error("Choose a responsibility.");
      return { action: data.action, authUserId: uuid("authUserId"), capability: capability as LeadershipResponsibility, reason };
    }
    case "ready": return { action: "ready", authUserId: uuid("authUserId"), circleId: uuid("circleId"), reason };
    case "start": {
      if (typeof data.temporary !== "boolean") throw new Error("Choose permanent or temporary coverage.");
      return { action: "start", authUserId: uuid("authUserId"), circleId: uuid("circleId"), temporary: data.temporary, reason };
    }
    case "end": return { action: "end", assignmentId: assignment(), coverAuthUserId: data.coverAuthUserId ? uuid("coverAuthUserId") : null, reason };
    case "request_reimbursement": {
      const periodStart = date("periodStart"), periodEnd = date("periodEnd");
      const amountMinor = data.amountMinor;
      // USD only until other currencies and their minor-unit conventions are explicitly configured.
      if (data.currency !== "USD" || !Number.isSafeInteger(amountMinor) || Number(amountMinor) <= 0 || Number(amountMinor) > 10000000) throw new Error("Enter a USD amount between $0.01 and $100,000.");
      if (periodStart > periodEnd) throw new Error("The service period must end on or after it starts.");
      return { action: "request_reimbursement", assignmentId: assignment(), periodStart, periodEnd, amountMinor: Number(amountMinor), currency: "USD", reason };
    }
    case "approve": case "reject": return { action: data.action, reimbursementId: uuid("reimbursementId"), reason };
    case "process": return { action: "process", reimbursementId: uuid("reimbursementId"), reference: text("reference", 160), processedAt: date("processedAt"), reason };
    default: throw new Error("Choose a leadership action.");
  }
}
