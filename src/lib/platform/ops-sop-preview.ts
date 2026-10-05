import type { OpsSopEditorData, OpsSopSnapshot } from "./ops-sop-model";

// Illustrative local content only. The production library starts empty.
export const PREVIEW_OPS_SOPS: OpsSopSnapshot = {
  canManage: true,
  procedures: [
    {
      id: "11111111-1111-4111-8111-111111111101",
      title: "Schedule a member call",
      summary: "A place for the team’s scheduling checklist, meeting details, and follow-up.",
      category: "Calls & events",
      bodyText: "## Purpose\nKeep the call details and intended audience in one place.\n\n## Before you begin\nConfirm the host, date, time zone, and audience with the team.\n\n## Steps\n1. Open Events in Operations and create the call.\n2. Add the confirmed time, description, and audience.\n3. Review the details before publishing.\n4. Check the meeting link and invitation delivery status.\n\n## If something changes\nUpdate the existing call and check that the changes have synced.\n\nThis is an example for preview. Replace it with your approved procedure.",
      externalUrl: null,
      status: "published",
      revision: 1,
      createdAt: "2026-10-05T14:00:00.000Z",
      updatedAt: "2026-10-05T14:00:00.000Z",
      publishedAt: "2026-10-05T14:00:00.000Z",
      updatedBy: "Preview operator",
    },
    {
      id: "11111111-1111-4111-8111-111111111102",
      title: "Welcome a new member",
      summary: "Build the team’s process for reviewing completed registration and the next steps.",
      category: "Membership",
      bodyText: "## Purpose\nDescribe what a successful welcome looks like.\n\n## Checklist\n- Add the registration checks your team follows.\n- Explain who owns the next step.\n- Link to the approved communication template.\n\n## Questions or exceptions\nName the person or team responsible for resolving them.",
      externalUrl: null,
      status: "draft",
      revision: 1,
      createdAt: "2026-10-05T14:00:00.000Z",
      updatedAt: "2026-10-05T14:00:00.000Z",
      publishedAt: null,
      updatedBy: "Preview operator",
    },
  ],
};

export function getPreviewOpsSop(id: string): OpsSopEditorData | null {
  const procedure = PREVIEW_OPS_SOPS.procedures.find((item) => item.id === id);
  if (!procedure) return null;
  return { canManage: true, procedure, history: [{ ...procedure }] };
}
