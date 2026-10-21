/** Approved CADE one-off copy. These templates never select recipients or schedule delivery. */
export type ManualCommunicationTemplate = { id: string; title: string; channel: "emails" | "texts"; subject: string; body: string; dependency: string; bucket: "membership" | "misc" };
export const CADE_MANUAL_TEMPLATES: readonly ManualCommunicationTemplate[] = [
  {
    "id": "clothing-drop",
    "title": "Clothing drop",
    "channel": "emails",
    "subject": "You get it first.",
    "body": "(NAME), we made something new.\n\nAnd before we put it in front of everyone else, we're giving RU/NED members first access.\n\n[DROP / COLLECTION NAME]\n\nMEMBER ACCESS STARTS: [DATE/TIME]\n\nPUBLIC ACCESS STARTS: [DATE/TIME]\n\nSHOP EARLY: [LINK]\n\n[IF MEMBER DISCOUNT EXISTS: Your member code gets you 25% off: [CODE]]\n\nSome pieces may be limited, so if you want something, this is your head start.\n\nGo look.\n\nRU/NED\nAfter the fear.",
    "dependency": "Confirm member access dates, inventory and the approved benefit. The conditional 25% example is not an approved member discount; remove it unless separately authorized.",
    "bucket": "misc"
  },
  {
    "id": "new-product",
    "title": "New product or program",
    "channel": "emails",
    "subject": "You get it first.",
    "body": "(NAME), we wanted you to hear this from us first.\n\nWe're launching [PRODUCT / PROGRAM / THING].\n\n[2–4 SENTENCES EXPLAINING WHAT IT ACTUALLY IS AND WHY RU/NED CREATED IT.]\n\nBecause you're already part of RU/NED, you're hearing about it before we announce it publicly.\n\n[MEMBER-SPECIFIC ACCESS / BENEFIT / DISCOUNT — IF APPLICABLE / NEXT STEP, IF ANY]\n\nLEARN MORE: [LINK]\n\nMore soon.\n\nRU/NED\nAfter the fear.",
    "dependency": "Fill in the actual launch, explanation, member access and link. Remove any benefit that has not been approved.",
    "bucket": "misc"
  },
  {
    "id": "platform-update",
    "title": "Platform or program update",
    "channel": "emails",
    "subject": "An important RU/NED update.",
    "body": "(NAME), we need you to know about a change to [THING].\n\nWHAT'S CHANGING:\n[CLEAR EXPLANATION]\n\nWHEN:\n[DATE/TIME]\n\nWHAT THIS MEANS FOR YOU:\n[IMPACT]\n\nWHAT YOU NEED TO DO:\n[ACTION]\n\nIf you have questions or something doesn't look right, reach out at connect@theruinedproject.com.\n\nRU/NED",
    "dependency": "Confirm the change, effective time, affected members and required action.",
    "bucket": "misc"
  },
  {
    "id": "urgent-update",
    "title": "Urgent call change",
    "channel": "emails",
    "subject": "CHANGE: Your RU/NED call on [DATE].",
    "body": "(NAME), there's been a change to your upcoming RU/NED call.\n\nORIGINAL:\n[DATE/TIME]\n\nNEW:\n[DATE/TIME]\n\n[IF LINK CHANGED: NEW CALL LINK: LINK]\n\nYour RU/NED calendar/profile has been updated.\n\nPlease use the new information above when joining the call.\n\nQuestions? connect@theruinedproject.com\n\nRU/NED",
    "dependency": "Update the actual call and member calendar first. Confirm old/new times and links; choose only the affected recipients.",
    "bucket": "misc"
  },
  {
    "id": "circle-change",
    "title": "Circle change",
    "channel": "emails",
    "subject": "A change to your Circle.",
    "body": "(NAME), we have an update for [CIRCLE NAME].\n\nBeginning [DATE], [NEW LEADER NAME] will be stepping into the [NEW SHAPER TITLE] role for your Circle.\n\n[1–3 SENTENCES EXPLAINING THE CHANGE IF APPROPRIATE.]\n\nWHAT ISN'T CHANGING:\n\nYour Circle remains [CIRCLE NAME], and your regular WHY / BUILD rhythm will continue.\n\n[IF SOMETHING ELSE IS CHANGING: DETAILS.]\n\nYour next Circle call is:\n\n[WHY / BUILD]\n[DATE] · [TIME] MT\n\nYour call information will continue to live in your RU/NED profile.\n\nQuestions? Reach out at connect@theruinedproject.com.\n\nRU/NED",
    "dependency": "Confirm the actual Circle assignment, effective date, leader/title and next call. Do not promise an unchanged rhythm unless verified.",
    "bucket": "membership"
  },
  {
    "id": "urgent-text",
    "title": "Urgent call change · text",
    "channel": "texts",
    "subject": "",
    "body": "RU/NED schedule change: Your [CALL] originally scheduled for [OLD] has moved to [NEW]. Details are in your email/profile. Questions: connect@theruinedproject.com",
    "dependency": "Confirm the call change and affected recipients. This is reusable copy only; it does not enable SMS, grant consent or send a text.",
    "bucket": "misc"
  }
];
export function findManualCommunicationTemplate(id: string | null | undefined): ManualCommunicationTemplate | null {
  return CADE_MANUAL_TEMPLATES.find(item => item.id === id) ?? null;
}
/** Fill or remove every source placeholder before importing a draft into the send workflow. */
export function manualCommunicationDraftIssue(subject: string, body: string, channel: "emails" | "texts" = "emails"): string | null {
  if ((channel === "emails" && !subject.trim()) || !body.trim()) return "Add the subject and message before continuing.";
  if (subject.length > 200 || body.length > 12000) return "Keep the subject within 200 characters and the message within 12,000 characters.";
  if (/\[[^\]]*\]|\(NAME\)|\{[^}]*\}/i.test(subject + "\n" + body)) return "Fill in or remove every bracketed instruction and the name placeholder before continuing.";
  return null;
}
