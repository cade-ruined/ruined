import assert from "node:assert/strict";
import test from "node:test";
import { id, loader } from "./helpers/member-sms-fixture.mjs";

const load = loader();
const { getMemberSmsTemplatePreviews: previews, memberSmsOperationNoticeMinutes: noticeMinutes } = load("src/lib/communications/member-sms-operations-model.ts");
const { memberSmsReminderBody } = load("src/lib/communications/member-sms-model.ts");
const { MEMBER_SMS_CALL_NOTICE_MINUTES, MEMBER_SMS_FOUNDATIONS_01_NOTICE_MINUTES, MEMBER_SMS_AUTOMATION_LOOKBACK_MINUTES } = load("src/lib/communications/member-sms-automation-model.ts");
const origin = "https://members.theruinedproject.com";

test("operations previews use the delivery renderer and distinguish fixed copy from fictional call values", () => {
  const rows = previews(origin);
  assert.deepEqual(rows.map(row => row.id), ["opt_in_confirmation", "call_reminder", "foundations_01"]);
  const [confirmation, standard, foundations] = rows;
  assert.equal(confirmation.bodyIsExample, false);
  assert.deepEqual(confirmation.variables, []);
  assert.equal(confirmation.noticeMinutes, null);
  assert.equal(confirmation.body, memberSmsReminderBody({ memberId: id(1), reminderKey: "consent:1", kind: "opt_in_confirmation", expectedConsentId: "1" }, origin));
  assert.match(confirmation.timing, new RegExp(`Within ${MEMBER_SMS_AUTOMATION_LOOKBACK_MINUTES} minutes`));
  assert.match(confirmation.timing, /Older consent.*eligible call reminder/);

  const callDetails = { eventId: id(2), title: "Membership call", startsAt: "2030-01-15T19:00:00.000Z", timeZone: "America/Denver" };
  assert.equal(standard.body, memberSmsReminderBody({ memberId: id(1), reminderKey: "preview:standard-call", kind: "call_reminder", callDetails }, origin));
  assert.equal(foundations.body, memberSmsReminderBody({ memberId: id(1), reminderKey: "preview:foundations-01", kind: "call_reminder", callDetails: {
    ...callDetails, title: "Foundations 01", foundations01: true, meetingUrl: "https://meet.google.com/abc-defg-hij",
  } }, origin));
  assert.equal(standard.noticeMinutes, MEMBER_SMS_CALL_NOTICE_MINUTES);
  assert.equal(foundations.noticeMinutes, MEMBER_SMS_FOUNDATIONS_01_NOTICE_MINUTES);
  assert.ok([standard, foundations].every(row => row.bodyIsExample && row.variables.length > 0));
  assert.match(standard.body, /Membership call.*Jan 15.*12:00 PM.*\/my\/experiences/);
  assert.doesNotMatch(standard.body, /meet\.google\.com/);
  assert.match(foundations.body, /Foundations starts today at 12:00 PM.*meet\.google\.com\/abc-defg-hij/);
  assert.ok(rows.every(row => row.body.includes("STOP") && row.body.includes("HELP") && row.audience && row.trigger));
  assert.match(foundations.trigger, /explicitly assigned.*invite-only.*internal registration/);
});

test("150-minute preview classification requires the explicit Foundations 01 assignment and matching access configuration", () => {
  assert.equal(noticeMinutes({ foundations01: true, visibility: "invite_only", registrationMode: "internal" }), MEMBER_SMS_FOUNDATIONS_01_NOTICE_MINUTES);
  for (const configuration of [
    { foundations01: false, visibility: "invite_only", registrationMode: "internal", title: "Foundations 01" },
    { foundations01: true, visibility: "members", registrationMode: "internal" },
    { foundations01: true, visibility: "invite_only", registrationMode: "none" },
    { foundations01: false, visibility: "public", registrationMode: "external" },
  ]) assert.equal(noticeMinutes(configuration), MEMBER_SMS_CALL_NOTICE_MINUTES);
});

test("previews are fresh descriptions without recipient data, consent changes, or delivery commands", () => {
  const rows = previews(origin);
  assert.ok(rows.every(row => !Object.hasOwn(row, "memberId") && !Object.hasOwn(row, "send") && !Object.hasOwn(row, "recipientCount")));
  rows[1].variables.push("changed");
  rows[0].body = "changed";
  const fresh = previews(origin);
  assert.equal(fresh[1].variables.includes("changed"), false);
  assert.notEqual(fresh[0].body, "changed");
});
