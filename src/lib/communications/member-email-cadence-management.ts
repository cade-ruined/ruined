import type { CadenceConfiguration, CadenceEvent, CadenceKind, CadenceOccurrence, CadenceStage, CadenceTrack } from "./member-email-cadence-model";
import type { AutomatedEmailWorkflow } from "./automated-email-catalog";
import type { CadenceDraft } from "./member-email-cadence-types";
import type { ResendEmailTemplate, ResendEmailTemplateSummary } from "./resend-email-model";

export type CadenceManagementStatus = "upcoming" | "paused" | "changed" | "cancelled" | "unavailable" | "past" | "no_remaining" | "inheritance_pending" | "manual_override" | "blocked";
export type CadenceDeliveryCounts = { sent:number; pending:number; failed:number; manualReview:number; cancelled:number };
/** A scheduled opportunity, never a promise that an email will be delivered. */
export type CadenceNextReminder = CadenceOccurrence & { eventId:string; eventTitle:string; timeZone:string };
export type CadenceUpcomingReminder = CadenceNextReminder & {
  planId:string; sequenceId:string|null; kind:CadenceKind; track:CadenceTrack;
  status:CadenceManagementStatus; active:boolean; attention:string;
};
export type CadenceManagementSummary = {
  id:string; kind:CadenceKind; track:CadenceTrack; active:boolean; revision:number; templateName:string; updatedAt:string;
  title:string; status:CadenceManagementStatus; attention:string; timingSummary:string; audienceSummary:string;
  inheritanceSummary:string; nextReminder:CadenceNextReminder|null; delivery:CadenceDeliveryCounts;
};
export type CadencePlanSummary = CadenceManagementSummary & { eventId:string; sequenceId:string|null };
export type CadenceSequenceSummary = CadenceManagementSummary & { matchingCallCount:number };
export type CadenceManagementPlanSummary = CadencePlanSummary;
export type CadenceManagementSequenceSummary = CadenceSequenceSummary;
export type CadenceManagementOverview = {
  events:CadenceEvent[]; plans:CadencePlanSummary[]; sequences:CadenceSequenceSummary[];
  templates:ResendEmailTemplateSummary[]; configuration:CadenceConfiguration;
  inactive:Array<{title:string;reason:string}>; setupRequired:boolean; warnings:string[]; managedElsewhere:AutomatedEmailWorkflow[];
  upcoming?:CadenceUpcomingReminder[]; recentDeliveries?:CadenceDeliveryActivity[];
};
export type CadenceManagedCall = CadenceEvent & {
  planId:string|null; revision:number|null; active:boolean; status:CadenceManagementStatus; attention:string;
  nextReminder:CadenceNextReminder|null; delivery:CadenceDeliveryCounts;
};
export type CadenceDeliveryOutcome = {
  id:string; eventId:string; eventTitle:string; stage:CadenceStage;
  status:"pending"|"sending"|"failed"|"sent"|"cancelled"|"manual_review";
  dueAt:string; updatedAt:string; sentAt:string|null; reason:string;
};
/** Counts are provider handoffs, not inferred inbox delivery or open events. */
export type CadenceDeliveryActivity = CadenceDeliveryOutcome & {
  planId:string; sequenceId:string|null; kind:CadenceKind; track:CadenceTrack; recipientCount:number;
  counts:Record<CadenceDeliveryOutcome["status"],number>;
};
export type CadenceManagementDetail = {
  scope:"event"|"sequence"; id:string; revision:number; active:boolean; title:string; status:CadenceManagementStatus;
  draft:CadenceDraft; template:ResendEmailTemplate; configuration:CadenceConfiguration;
  timingSummary:string; audienceSummary:string; inheritanceSummary:string; nextReminder:CadenceNextReminder|null;
  calls:CadenceManagedCall[]; selectedEventId:string|null; previewIsExample:boolean;
  previews:Array<{stage:CadenceStage;html:string;subject:string;text:string}>;
  messageDefaults?:Array<{stage:CadenceStage;subject:string;message:string}>;
  occurrences:CadenceOccurrence[];
  recipients:Array<{memberId:string;name:string;email:string;eligible:boolean;reason:string}>;
  recipientsChecked:boolean; recentDeliveries:CadenceDeliveryOutcome[]; warnings:string[];
};

export function cadenceManagementDescriptions(kind:CadenceKind,track:CadenceTrack) {
  const timingSummary=kind==="foundations_01" && track==="members"
    ? "16 calendar days and 7 calendar days before; 24 hours before; 8 a.m. Denver time on the call day."
    : kind==="foundations_01" && track==="founder_test"
      ? "48 hours before; 24 hours before; 2½ hours before the call."
      : "24 hours before and 2½ hours before the call.";
  const audienceSummary=track==="founder_test"
    ? "Explicitly invited founders on this call’s confirmed roster, with current access, verified email, and enabled membership email reminders."
    : kind.startsWith("foundations_")
      ? "Confirmed call invitations, including matching paid cohort enrollment and other approved invitations. Current access, verified email, and enabled membership email reminders are required."
      : kind==="circle"
        ? "Current eligible members of this call’s Circle, with verified email and enabled membership email reminders. A confirmed registration is required when the call uses an invited roster. Cancellations are respected."
        : "The call’s current eligible member audience, with verified email and enabled membership email reminders. A confirmed registration is required when configured. Cancellations and audience restrictions are respected.";
  const inheritanceSummary="The saved approved design applies to matching published future calls. Individual overrides and paused calls are preserved; past stages are never replayed.";
  return {timingSummary,audienceSummary,inheritanceSummary};
}
