"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import OperatorDialog from "@/components/platform/OperatorDialog";

import {
  OPERATOR_BUTTON_CLASS,
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
} from "@/components/platform/operatorStyles";
import type { OperatorMemberSummary } from "@/lib/platform/model";

export type OpsActionCircle = {
  activeMembers: number;
  blockId: string | null;
  blockName: string | null;
  blockStatus: "active" | "archived" | "completed" | "forming" | null;
  capacity: number;
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived" | "completed" | "forming";
};

export type OpsActionBlock = {
  circles: Array<{
    id: string;
    name: string;
    status: OpsActionCircle["status"];
  }>;
  currentCircles: number;
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived" | "completed" | "forming";
};

type ActionNotice = {
  kind: "error" | "success";
  text: string;
} | null;

async function postJson<T>(
  path: string,
  body: Record<string, string>,
  method: "DELETE" | "PATCH" | "POST" = "POST",
): Promise<T> {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
  const payload = (await response.json().catch(() => null)) as
    | ({ error?: unknown } & T)
    | null;

  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : "The action could not be completed.";
    throw new Error(message);
  }
  if (!payload) throw new Error("The action did not return a result.");
  return payload;
}

function Notice({ notice }: { notice: ActionNotice }) {
  return (
    <p
      aria-live="polite"
      className={`min-h-5 text-xs leading-relaxed ${
        notice?.kind === "error" ? "text-[var(--color-poster)]" : "text-black/48"
      }`}
      role={notice?.kind === "error" ? "alert" : "status"}
    >
      {notice?.text ?? " "}
    </p>
  );
}

const INPUT_CLASS = OPERATOR_FIELD_CLASS;
const BUTTON_CLASS = OPERATOR_BUTTON_CLASS;
const SECONDARY_BUTTON_CLASS =
  "min-h-12 rounded-[4px] border border-black/35 bg-transparent px-5 font-[var(--font-body)] text-[0.62rem] font-medium uppercase tracking-[0.15em] text-black/65 hover:border-black hover:text-black disabled:cursor-not-allowed disabled:border-black/15 disabled:text-black/25";

export function OpsInvitationActions({ preview = false, onSaved }: { preview?: boolean; onSaved?: () => void } = {}) {
  const sampleEmail = "sample.member@example.com";
  const signInUrl = "https://members.theruinedproject.com/access";
  const [email, setEmail] = useState(preview ? sampleEmail : "");
  const emailRef = useRef(email);
  const pendingRef = useRef(false);
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  const revokeEmailRef = useRef<string | null>(null);
  const copyVersion = useRef(0);
  const copyingRef = useRef(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const allowanceRef = useRef<{ email: string; expiresAt: string; sample: boolean } | null>(null);
  const [pending, setPending] = useState<"allow" | "revoke" | null>(null);
  const [notice, setNotice] = useState<ActionNotice>(null);
  const [allowance, setAllowance] = useState<{ email: string; expiresAt: string; sample: boolean } | null>(null);
  const [expired, setExpired] = useState(false);
  const [allowanceUncertain, setAllowanceUncertain] = useState(false);
  const [revokeEmail, setRevokeEmail] = useState<string | null>(null);
  const [copying, setCopying] = useState<"message" | "link" | null>(null);
  const [copyNotice, setCopyNotice] = useState<ActionNotice>(null);

  useEffect(() => {
    const requests = requestVersion;
    const copies = copyVersion;
    mounted.current = true;
    return () => { mounted.current = false; requests.current++; copies.current++; };
  }, []);

  useEffect(() => {
    if (!allowance) return;
    const timer = setTimeout(() => setExpired(Date.parse(allowance.expiresAt) <= Date.now()), Math.min(2_147_483_647, Math.max(0, Date.parse(allowance.expiresAt) - Date.now()) + 10));
    return () => clearTimeout(timer);
  }, [allowance]);

  const normalizeEmail = (value: string) => value.trim().toLowerCase();
  const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const formatExpiration = (value: string) => new Intl.DateTimeFormat("en-US", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(value));
  const canShare = Boolean(allowance && !allowanceUncertain && !expired && Date.parse(allowance.expiresAt) > Date.now());
  const message = allowance ? `${allowance.sample ? "PREVIEW — SAMPLE ONLY\n\n" : ""}You're invited to join Ruined.\n\nSign in at ${signInUrl} using ${allowance.email} before ${formatExpiration(allowance.expiresAt)}. Request your own email code, then complete your profile, membership agreement, and payment instructions. We'll then place you in a Circle.\n\nQuestions? Reach us at connect@theruinedproject.com.` : "";

  function changeEmail(value: string) {
    emailRef.current = value;
    requestVersion.current++;
    copyVersion.current++;
    revokeEmailRef.current = null;
    allowanceRef.current = null;
    pendingRef.current = false;
    setPending(null);
    setEmail(value);
    setAllowance(null);
    setRevokeEmail(null);
    setNotice(null);
    setCopyNotice(null);
    setExpired(false);
    setAllowanceUncertain(false);
  }

  function rememberAllowance(value: { email: string; expiresAt: string; sample: boolean }) {
    copyVersion.current++;
    allowanceRef.current = value;
    setAllowance(value);
    setExpired(false);
    setAllowanceUncertain(false);
    setCopyNotice(null);
    setRevokeEmail(null);
    revokeEmailRef.current = null;
  }

  async function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || !mounted.current) return;
    if (preview) {
      emailRef.current = sampleEmail;
      setEmail(sampleEmail);
      rememberAllowance({ email: sampleEmail, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), sample: true });
      setNotice({ kind: "success", text: "Sample email allowed. No data changed and no email was sent." });
      return;
    }
    const form = new FormData(event.currentTarget);
    const email = normalizeEmail(String(form.get("email") ?? ""));
    if (!validEmail(email)) { setNotice({ kind: "error", text: "Enter the member's full email address." }); return; }
    emailRef.current = email;
    setEmail(email);
    pendingRef.current = true;
    const version = ++requestVersion.current;
    copyVersion.current++;
    allowanceRef.current = null;
    revokeEmailRef.current = null;
    setRevokeEmail(null);
    if (allowance) setAllowanceUncertain(true);
    setPending("allow");
    setNotice(null);
    setCopyNotice(null);
    try {
      const result = await postJson<{
        invitation: { email: string; expiresAt: string; reissued: boolean };
      }>("/api/ops/invitations", { email });
      if (!mounted.current || requestVersion.current !== version) return;
      const saved = result.invitation;
      if (!saved || saved.email !== email || typeof saved.expiresAt !== "string" || typeof saved.reissued !== "boolean"
        || !Number.isFinite(Date.parse(saved.expiresAt)) || Date.parse(saved.expiresAt) <= Date.now()) {
        throw new Error("The allowance could not be confirmed. Keep this email and retry before sharing sign-in instructions.");
      }
      rememberAllowance({ email: saved.email, expiresAt: saved.expiresAt, sample: false });
      setNotice({ kind: "success", text: `${saved.reissued ? "Allowance renewed" : "Email allowed"} for ${saved.email}. No email was sent.` });
      onSaved?.();
    } catch (error) {
      if (mounted.current && requestVersion.current === version) setNotice({ kind: "error", text: error instanceof Error ? error.message : "The email allowance could not be saved." });
    } finally {
      if (mounted.current && requestVersion.current === version) { pendingRef.current = false; setPending(null); }
    }
  }

  async function copyInstructions(kind: "message" | "link") {
    if (copyingRef.current || pendingRef.current || !mounted.current || allowanceRef.current !== allowance) return;
    if (!allowance || allowanceUncertain || Date.parse(allowance.expiresAt) <= Date.now()) {
      if (allowance && Date.parse(allowance.expiresAt) <= Date.now()) setExpired(true);
      setCopyNotice({ kind: "error", text: "Allow this email again before sharing sign-in instructions." });
      return;
    }
    copyingRef.current = true;
    const version = ++copyVersion.current;
    setCopying(kind);
    setCopyNotice(null);
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(kind === "message" ? message : signInUrl);
      if (mounted.current && copyVersion.current === version && Date.parse(allowance.expiresAt) > Date.now()) {
        setCopyNotice({ kind: "success", text: `${kind === "message" ? "Message" : "Sign-in link"} copied. Paste it into your own email or chat to ${allowance.email}. Nothing was sent automatically.` });
      }
    } catch {
      if (mounted.current && copyVersion.current === version) {
        setCopyNotice({ kind: "error", text: `Copying is unavailable here. Select the ${kind === "message" ? "message" : "link"} below and copy it manually.` });
        const field = kind === "message" ? messageRef.current : linkRef.current;
        field?.focus();
        field?.select();
      }
    } finally {
      copyingRef.current = false;
      if (mounted.current) setCopying(null);
    }
  }

  function reviewRevocation() {
    if (pendingRef.current || !mounted.current) return;
    const value = normalizeEmail(emailRef.current);
    if (!validEmail(value)) { setNotice({ kind: "error", text: "Enter the email whose pending allowance you want to remove." }); return; }
    setRevokeEmail(value);
    revokeEmailRef.current = value;
    setNotice(null);
  }

  async function confirmRevocation() {
    if (pendingRef.current || !mounted.current || !revokeEmail || revokeEmailRef.current !== revokeEmail || revokeEmail !== normalizeEmail(emailRef.current)) return;
    const email = revokeEmail;
    if (preview) {
      setAllowance(null);
      allowanceRef.current = null;
      setRevokeEmail(null);
      revokeEmailRef.current = null;
      setCopyNotice(null);
      copyVersion.current++;
      setNotice({ kind: "success", text: "Sample allowance removed. No data changed and no member account was deleted." });
      return;
    }
    pendingRef.current = true;
    const version = ++requestVersion.current;
    setPending("revoke");
    setAllowanceUncertain(true);
    allowanceRef.current = null;
    copyVersion.current++;
    setNotice(null);
    try {
      const result = await postJson<{ revocation: { email: string; revoked: number } }>("/api/ops/invitations", { email }, "DELETE");
      if (!mounted.current || requestVersion.current !== version) return;
      if (!result.revocation || result.revocation.email !== email || !Number.isInteger(result.revocation.revoked) || result.revocation.revoked < 0) {
        throw new Error("The removal could not be confirmed. Keep this email and check its allowance before sharing instructions.");
      }
      setAllowance(null);
      setRevokeEmail(null);
      revokeEmailRef.current = null;
      setCopyNotice(null);
      copyVersion.current++;
      setNotice({ kind: "success", text: result.revocation.revoked === 0
        ? `No pending allowance was found for ${email}. Existing member accounts are unchanged.`
        : `Pending allowance removed for ${email}. No member account was deleted.` });
      onSaved?.();
    } catch (error) {
      if (mounted.current && requestVersion.current === version) setNotice({ kind: "error", text: error instanceof Error ? error.message : "The pending allowance could not be removed." });
    } finally {
      if (mounted.current && requestVersion.current === version) { pendingRef.current = false; setPending(null); }
    }
  }

  return (
    <div aria-label="Add member steps" data-operator-pending={pending || copying ? "true" : undefined} data-operator-dirty={email.trim() !== (preview ? sampleEmail : "") && !allowance || revokeEmail ? "true" : undefined}>
      {preview ? <p className="mb-4 text-sm text-black/60">Preview — sample only. Email allowances are not changed and no email is sent.</p> : null}
      <ol className="grid list-none gap-6 p-0">
        <li>
          <h3 className="ui-heading mb-2 text-lg font-semibold" id="member-allow-step">1. Allow email to join</h3>
          <p className="mb-4 text-sm leading-relaxed text-black/60">This allows sign-in for their email. They can open the shared members link and request their own code—no invitation link needed. This step does not send a message or grant operator access.</p>
          <form aria-labelledby="member-allow-step" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={submitInvitation}>
            <label className={OPERATOR_LABEL_CLASS} htmlFor="ops-invitation-email">
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Member email</span>
              <input autoComplete="email" className={INPUT_CLASS} disabled={Boolean(pending)} id="ops-invitation-email" maxLength={254}
                name="email" onChange={(event) => changeEmail(event.currentTarget.value)} placeholder="member@email.com" readOnly={preview} required type="email" value={email} />
            </label>
            <button className={BUTTON_CLASS} disabled={Boolean(pending)} type="submit">{pending === "allow" ? "Allowing email…" : "Add member"}</button>
          </form>
          <Notice notice={notice} />
        </li>
        <li aria-labelledby="member-share-step">
          <h3 className="ui-heading mb-2 text-lg font-semibold" id="member-share-step">2. Share sign-in instructions</h3>
          {allowance ? (
            <div className="space-y-3 text-sm leading-relaxed">
              <p className="break-words"><strong>{allowance.email}</strong><br />{allowanceUncertain ? "Last confirmed expiry:" : `${allowance.sample ? "Sample allowance" : "Joining allowance"} ${canShare ? "expires" : "expired"}`} <time dateTime={allowance.expiresAt}>{formatExpiration(allowance.expiresAt)}</time>.</p>
              {allowanceUncertain ? <p role="status" className="text-[var(--color-poster)]">Check this allowance before sharing. Use Add member again to confirm it.</p>
                : canShare ? <p className="text-black/65">Your next action: send them the message below. They request their own code and complete their profile, agreement, and payment instructions. Then you place them in a Circle.</p>
                : <p role="status" className="text-[var(--color-poster)]">Allow this email again before sharing. An expired allowance cannot start a new member account.</p>}
              <div className="flex flex-wrap gap-3">
                <button className={BUTTON_CLASS} disabled={!canShare || Boolean(pending) || Boolean(copying)} onClick={() => void copyInstructions("message")} type="button">{copying === "message" ? "Copying…" : "Copy message"}</button>
                <button className={`${BUTTON_CLASS} !bg-transparent !text-[var(--color-faded)]`} disabled={!canShare || Boolean(pending) || Boolean(copying)} onClick={() => void copyInstructions("link")} type="button">{copying === "link" ? "Copying…" : "Copy link"}</button>
              </div>
              <Notice notice={copyNotice} />
              {canShare ? <><label className="block" htmlFor="member-share-message"><span className="font-semibold">Message to share</span>
                <textarea className={`${INPUT_CLASS} min-h-40 !bg-[var(--color-bone)] text-sm`} id="member-share-message" readOnly ref={messageRef} rows={6} value={message} />
              </label>
              <label className="block" htmlFor="member-share-link"><span className="font-semibold">Sign-in link</span>
                <input className={`${INPUT_CLASS} !bg-[var(--color-bone)] text-sm`} id="member-share-link" readOnly ref={linkRef} type="url" value={signInUrl} />
              </label>
              <p className="text-xs text-black/60">You can select either field and copy it manually. Copying does not send anything.</p></> : null}
            </div>
          ) : <p className="text-sm text-black/55">Allow their email first. Their message and sign-in link will appear here.</p>}
        </li>
      </ol>
      <div className="mt-8">
        <button aria-expanded={Boolean(revokeEmail)} className="min-h-11 text-sm text-black/60 underline underline-offset-4 disabled:opacity-40" disabled={Boolean(pending)} onClick={reviewRevocation} type="button">Remove a pending allowance</button>
        {revokeEmail ? <section aria-label="Confirm pending allowance removal" className="mt-3 space-y-3 rounded-[4px] bg-black/5 p-4 text-sm">
          <p className="break-words">Remove pending joining access for <strong>{revokeEmail}</strong>?</p>
          <p className="text-black/65">This does not delete a member account, end a membership, or change operator access.</p>
          <div className="flex flex-wrap gap-3">
            <button className={BUTTON_CLASS} disabled={Boolean(pending)} onClick={() => void confirmRevocation()} type="button">{pending === "revoke" ? "Removing…" : "Confirm removal"}</button>
            <button className={`${BUTTON_CLASS} !bg-transparent !text-[var(--color-faded)]`} disabled={Boolean(pending)} onClick={() => { revokeEmailRef.current = null; setRevokeEmail(null); }} type="button">Keep allowance</button>
          </div>
        </section> : null}
      </div>
    </div>
  );
}

export function getCirclePlacementIssue(member: OperatorMemberSummary): string | null {
  if (member.circleName) return `Already assigned to ${member.circleName}. Open their Circle and choose Move to switch Circles.`;
  const missing: string[] = [];
  if (member.accountState !== "active") missing.push(`an active account (currently ${member.accountState})`);
  if (member.membershipFunding !== "operator" && member.membershipFunding !== "complimentary" && member.billingState !== "active") missing.push(`active billing (currently ${member.billingState.replaceAll("_", " ")})`);
  if (member.administrativeOnboardingState && member.administrativeOnboardingState !== "completed") missing.push("completed profile and agreement");
  if (member.standingState && member.standingState !== "active" && !(member.standingState === "cancellation_requested" && member.cancellationEffectiveAt && new Date(member.cancellationEffectiveAt).getTime() > Date.now())) missing.push("active membership standing");
  if (member.programState !== "onboarding" && member.programState !== "active") {
    missing.push(`an onboarding or active program (currently ${member.programState})`);
  }
  return missing.length ? `Before placement, this member needs ${missing.join(" and ")}. Review their membership record first.` : null;
}

export function OpsCircleActions({
  initialCircles,
  initialMemberId,
  members,
}: {
  initialCircles: OpsActionCircle[];
  initialMemberId?: string;
  members: OperatorMemberSummary[];
}) {
  const router = useRouter();
  const createFormRef = useRef<HTMLFormElement>(null);
  const assignmentFormRef = useRef<HTMLFormElement>(null);
  const activationFormRef = useRef<HTMLFormElement>(null);
  const endAssignmentFormRef = useRef<HTMLFormElement>(null);
  const [circles, setCircles] = useState(initialCircles);
  const [assignedMemberIds, setAssignedMemberIds] = useState<Set<string>>(() => new Set());
  const [endedMemberIds, setEndedMemberIds] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [activating, setActivating] = useState(false);
  const [endingAssignment, setEndingAssignment] = useState(false);
  const [createNotice, setCreateNotice] = useState<ActionNotice>(null);
  const [assignmentNotice, setAssignmentNotice] = useState<ActionNotice>(null);
  const [activationNotice, setActivationNotice] = useState<ActionNotice>(null);
  const [endAssignmentNotice, setEndAssignmentNotice] = useState<ActionNotice>(null);
  const [selectedMemberId, setSelectedMemberId] = useState(initialMemberId ?? "");
  const [selectedCircleId, setSelectedCircleId] = useState("");
  const [activationCircleId, setActivationCircleId] = useState("");
  const [createOpen, setCreateOpen] = useState(initialCircles.length === 0);

  useEffect(() => setCircles(initialCircles), [initialCircles]);
  useEffect(() => setSelectedMemberId(initialMemberId ?? ""), [initialMemberId]);

  function placementIssue(member: OperatorMemberSummary) {
    if (assignedMemberIds.has(member.memberId)) return "This member has just been assigned. Refresh the membership record before making another change.";
    return getCirclePlacementIssue(endedMemberIds.has(member.memberId) ? { ...member, circleName: null } : member);
  }
  const eligibleMembers = members.filter((member) => !placementIssue(member));
  // Query-string IDs only select records already supplied by the authorized page.
  const selectedMember = members.find((member) => member.memberId === selectedMemberId);
  const selectedMemberIssue = selectedMember
    ? placementIssue(selectedMember)
    : selectedMemberId ? "This member is not in the member list available to you. Choose a member below or ask an Administrator to check their account." : null;
  const acceptingCircles = circles.filter(
    (circle) =>
      (circle.status === "forming" || circle.status === "active") &&
      circle.activeMembers < circle.capacity,
  );
  const activatableCircles = circles.filter(
    (circle) => circle.status === "forming" && circle.activeMembers > 0,
  );
  const selectedMemberCircles = selectedMember && selectedMember.memberId === initialMemberId && selectedMember.circleName
    ? activatableCircles.filter((circle) => circle.name === selectedMember.circleName)
    : [];
  const selectedActivationCircleId = activationCircleId || (selectedMemberCircles.length === 1 ? selectedMemberCircles[0].id : "");
  const assignedMembers = members.filter(
    (member) => Boolean(member.circleName) && !endedMemberIds.has(member.memberId),
  );
  const selectedCircle = acceptingCircles.find((circle) => circle.id === selectedCircleId);

  async function submitCircle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateNotice(null);

    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");

    try {
      const result = await postJson<{ circle: OpsActionCircle }>("/api/ops/circles", { name });
      setCircles((current) => [...current, result.circle]);
      setSelectedCircleId(result.circle.id);
      setCreateNotice({ kind: "success", text: `${result.circle.name} created with ${result.circle.capacity} spaces. Choose a member above to make the first assignment.` });
      createFormRef.current?.reset();
      router.refresh();
    } catch (error) {
      setCreateNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Circle could not be created.",
      });
    } finally {
      setCreating(false);
    }
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAssigning(true);
    setAssignmentNotice(null);

    const form = new FormData(event.currentTarget);
    const memberId = String(form.get("memberId") ?? "");
    const circleId = String(form.get("circleId") ?? "");
    const member = eligibleMembers.find((candidate) => candidate.memberId === memberId);
    const circle = acceptingCircles.find((candidate) => candidate.id === circleId);

    try {
      if (!member || !circle) throw new Error("Choose an eligible member and a forming or active Circle with an open space.");
      const result = await postJson<{ assignment: { created: boolean } }>("/api/ops/circle-assignments", {
        circleId,
        memberId,
      });
      setAssignedMemberIds((current) => new Set(current).add(memberId));
      setEndedMemberIds((current) => {
        const next = new Set(current);
        next.delete(memberId);
        return next;
      });
      if (result.assignment.created) {
        setCircles((current) =>
          current.map((candidate) =>
            candidate.id === circleId
              ? { ...candidate, activeMembers: candidate.activeMembers + 1 }
              : candidate,
          ),
        );
      }
      setAssignmentNotice({
        kind: "success",
        text: result.assignment.created
          ? `${member.name} assigned to ${circle.name}.${circle.status === "forming" ? " Next: activate the Circle when it is ready. This lets its members complete Foundations." : " The Circle is already active."}`
          : `${member?.name ?? "Member"} is already assigned to ${circle?.name ?? "Circle"}.`,
      });
      setSelectedMemberId("");
      setSelectedCircleId("");
      if (circle.status === "forming") {
        setActivationCircleId(circle.id);
      }
      router.refresh();
    } catch (error) {
      setAssignmentNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The member could not be assigned.",
      });
    } finally {
      setAssigning(false);
    }
  }

  async function submitActivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActivating(true);
    setActivationNotice(null);

    const form = new FormData(event.currentTarget);
    const circleId = String(form.get("circleId") ?? "");
    const circle = circles.find((candidate) => candidate.id === circleId);

    try {
      const result = await postJson<{
        circle: OpsActionCircle & { activated: boolean };
      }>("/api/ops/circles", { circleId }, "PATCH");
      setCircles((current) =>
        current.map((candidate) =>
          candidate.id === circleId ? { ...candidate, status: "active" } : candidate,
        ),
      );
      setActivationNotice({
        kind: "success",
        text: result.circle.activated
          ? `${circle?.name ?? "Circle"} is active. Assigned members can now complete Foundations.`
          : `${circle?.name ?? "Circle"} is already active.`,
      });
      activationFormRef.current?.reset();
      setActivationCircleId("");
      router.refresh();
    } catch (error) {
      setActivationNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Circle could not be activated.",
      });
    } finally {
      setActivating(false);
    }
  }

  async function submitEndAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEndingAssignment(true);
    setEndAssignmentNotice(null);

    const form = new FormData(event.currentTarget);
    const memberId = String(form.get("memberId") ?? "");
    const member = assignedMembers.find((candidate) => candidate.memberId === memberId);

    try {
      const result = await postJson<{
        assignment: {
          blockId: string | null;
          blockStatus: OpsActionBlock["status"] | null;
          circleId: string;
          circleStatus: OpsActionCircle["status"];
          endedAt: string;
        };
      }>("/api/ops/circle-assignments", { memberId }, "PATCH");
      setEndedMemberIds((current) => new Set(current).add(memberId));
      setAssignedMemberIds((current) => {
        const next = new Set(current);
        next.delete(memberId);
        return next;
      });
      setCircles((current) =>
        current.map((candidate) =>
          candidate.id === result.assignment.circleId
            ? {
                ...candidate,
                activeMembers: Math.max(0, candidate.activeMembers - 1),
                blockStatus:
                  candidate.blockId === result.assignment.blockId
                    ? result.assignment.blockStatus
                    : candidate.blockStatus,
                status: result.assignment.circleStatus,
              }
            : candidate,
        ),
      );
      setEndAssignmentNotice({
        kind: "success",
        text: result.assignment.blockStatus === "archived"
          ? `${member?.name ?? "Member"} no longer has an active Circle assignment. Its Circle and Block closed because each no longer meets the minimum active group size.`
          : `${member?.name ?? "Member"} no longer has an active Circle assignment.`,
      });
      endAssignmentFormRef.current?.reset();
      router.refresh();
    } catch (error) {
      setEndAssignmentNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Circle assignment could not be ended.",
      });
    } finally {
      setEndingAssignment(false);
    }
  }

  return (
    <section className="grid gap-4" aria-label="Circle administration">
      <section className="scroll-mt-40 rounded-[4px] bg-[var(--color-shop)]/25 p-5 sm:p-6" id="assign-member" aria-labelledby="assign-member-title">
        <h2 className="font-[var(--font-display)] text-2xl" id="assign-member-title">Assign a member</h2>
        <p className="mt-2 text-sm leading-relaxed text-black/60">
          Assign members first. A forming Circle can accept them now; activate it afterward when it is ready.
        </p>
        <form className="mt-5 grid gap-4" onSubmit={submitAssignment} ref={assignmentFormRef}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>1. Choose member</span>
              <select
                aria-describedby="circle-member-help"
                className={INPUT_CLASS}
                disabled={assigning || eligibleMembers.length === 0}
                name="memberId"
                onChange={(event) => { setSelectedMemberId(event.target.value); setAssignmentNotice(null); }}
                required
                value={selectedMember?.memberId ?? ""}
              >
                <option className="bg-[var(--color-bone)]" disabled value="">Choose member</option>
                {selectedMember && selectedMemberIssue ? <option disabled value={selectedMember.memberId}>{selectedMember.name} · not ready for placement</option> : null}
                {eligibleMembers.map((member) => <option className="bg-[var(--color-bone)]" key={member.memberId} value={member.memberId}>{member.name}</option>)}
              </select>
            </label>
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>2. Choose Circle</span>
              <select
                aria-describedby="circle-space-help"
                className={INPUT_CLASS}
                disabled={assigning || acceptingCircles.length === 0}
                name="circleId"
                onChange={(event) => { setSelectedCircleId(event.target.value); setAssignmentNotice(null); }}
                required
                value={selectedCircle?.id ?? ""}
              >
                <option className="bg-[var(--color-bone)]" disabled value="">Choose Circle</option>
                {acceptingCircles.map((circle) => <option className="bg-[var(--color-bone)]" key={circle.id} value={circle.id}>{circle.name} · {circle.status} · {circle.capacity - circle.activeMembers} {circle.capacity - circle.activeMembers === 1 ? "space" : "spaces"}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-3 text-sm leading-relaxed text-black/60 sm:grid-cols-2">
            <div aria-live="polite" id="circle-member-help">
              <p className={selectedMemberIssue ? "text-[var(--color-poster)]" : undefined}>
                {selectedMemberIssue ?? (eligibleMembers.length ? "Members need an active account, active billing, and an onboarding or active program." : "No members are ready for placement. Members need an active account, active billing, and an onboarding or active program, with no current Circle assignment.")}
              </p>
              {selectedMemberIssue && selectedMember ? (
                <Link className="mt-2 inline-block underline underline-offset-4" href={`/ops/members/${encodeURIComponent(selectedMember.memberId)}#membership`}>Review {selectedMember.name}’s membership →</Link>
              ) : null}
            </div>
            <div id="circle-space-help">
              {acceptingCircles.length ? (
                <p>{selectedCircle?.status === "forming" ? `${selectedCircle.name} is forming. Assign the member now, then activate it when ready.` : "Only forming or active Circles with open spaces are listed."}</p>
              ) : (
                <p>No Circles have an open space. <a className="underline underline-offset-4" href="#create-circle" onClick={() => setCreateOpen(true)}>Create a Circle</a> or review the existing assignments below.</p>
              )}
            </div>
          </div>
          <button
            className={`${BUTTON_CLASS} w-fit`}
            disabled={assigning || !selectedMember || Boolean(selectedMemberIssue) || !selectedCircle}
            type="submit"
          >
            {assigning ? "Assigning" : "3. Assign member"}
          </button>
          <Notice notice={assignmentNotice} />
        </form>
      </section>

      <details className="group scroll-mt-40 rounded-[4px] bg-black/[0.035]" id="create-circle" open={createOpen} onToggle={(event) => setCreateOpen(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:content-none">
          <span className="ui-heading text-lg font-semibold">Create a Circle</span>
          <span aria-hidden="true" className="text-2xl group-open:rotate-45">+</span>
        </summary>
        <div className="px-5 pb-5">
          <p className="text-sm text-black/60">A new Circle starts in forming with ten member spaces.</p>
          <form className="mt-4 grid gap-3" onSubmit={submitCircle} ref={createFormRef}>
            <label className={OPERATOR_LABEL_CLASS} htmlFor="ops-circle-name">
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Circle name</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input className={INPUT_CLASS} disabled={creating} id="ops-circle-name" maxLength={80} minLength={2} name="name" placeholder="Circle 03" required />
              <button className={BUTTON_CLASS} disabled={creating} type="submit">{creating ? "Creating" : "Create Circle"}</button>
            </div>
            <Notice notice={createNotice} />
          </form>
        </div>
      </details>

      <section className="scroll-mt-40 rounded-[4px] bg-black/[0.035]" id="activate-circle" aria-labelledby="activate-circle-title">
        <h2 className="px-5 py-4 ui-heading text-lg font-semibold" id="activate-circle-title">Activate a Circle <span className="ml-2 text-sm font-normal text-black/50">After placement</span></h2>
        <div className="px-5 pb-5">
        <div className="grid gap-8 lg:grid-cols-[minmax(12rem,0.55fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <p className="max-w-md text-sm leading-relaxed text-black/60">
              At least one member must be assigned first. Activation then allows those members to complete Foundations.
            </p>
            {!activatableCircles.length ? <p className="mt-2 text-sm text-black/60">No forming Circle is ready yet. Place its first member above.</p> : null}
          </div>
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={submitActivation} ref={activationFormRef}>
            <label className={OPERATOR_LABEL_CLASS} htmlFor="ops-circle-activation">
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Forming Circle</span>
              <select
                className={INPUT_CLASS}
                disabled={activating || activatableCircles.length === 0}
                id="ops-circle-activation"
                name="circleId"
                onChange={(event) => setActivationCircleId(event.target.value)}
                required
                value={activatableCircles.some((circle) => circle.id === selectedActivationCircleId) ? selectedActivationCircleId : ""}
              >
                <option className="bg-[var(--color-bone)]" disabled value="">Choose forming Circle</option>
                {activatableCircles.map((circle) => (
                  <option className="bg-[var(--color-bone)]" key={circle.id} value={circle.id}>
                    {circle.name} · {circle.activeMembers}/{circle.capacity}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={BUTTON_CLASS}
              disabled={activating || !activatableCircles.some((circle) => circle.id === selectedActivationCircleId)}
              type="submit"
            >
              {activating ? "Activating" : "Activate Circle"}
            </button>
            <div className="sm:col-span-2"><Notice notice={activationNotice} /></div>
          </form>
        </div>
        </div>
      </section>

      <details className="group rounded-[4px] bg-black/[0.035]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:content-none">
          <span className="ui-heading text-lg font-semibold">End an assignment</span>
          <span aria-hidden="true" className="text-2xl group-open:rotate-45">+</span>
        </summary>
        <div className="px-5 pb-5">
        <div className="grid gap-8 lg:grid-cols-[minmax(12rem,0.55fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <p className="max-w-md text-sm leading-relaxed text-black/52">
              Remove a mistaken or obsolete active assignment. Completed Foundations keeps its historical Circle proof; an active Circle is archived if its last member leaves.
            </p>
          </div>
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={submitEndAssignment} ref={endAssignmentFormRef}>
            <label className={OPERATOR_LABEL_CLASS} htmlFor="ops-circle-assignment-end">
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Assigned member</span>
              <select
                className={INPUT_CLASS}
                defaultValue=""
                disabled={endingAssignment || assignedMembers.length === 0}
                id="ops-circle-assignment-end"
                name="memberId"
                required
              >
                <option className="bg-[var(--color-bone)]" disabled value="">Choose assigned member</option>
                {assignedMembers.map((member) => (
                  <option className="bg-[var(--color-bone)]" key={member.memberId} value={member.memberId}>
                    {member.name} · {member.circleName}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={SECONDARY_BUTTON_CLASS}
              disabled={endingAssignment || assignedMembers.length === 0}
              type="submit"
            >
              {endingAssignment ? "Ending" : "End assignment"}
            </button>
            <div className="sm:col-span-2"><Notice notice={endAssignmentNotice} /></div>
          </form>
        </div>
        </div>
      </details>
    </section>
  );
}

export function OpsBlockActions({
  circles: initialCircles,
  initialBlocks,
  preview = false,
}: {
  circles: OpsActionCircle[];
  initialBlocks: OpsActionBlock[];
  preview?: boolean;
}) {
  const router = useRouter();
  const [blocks, setBlocks] = useState(initialBlocks);
  const [circles, setCircles] = useState(initialCircles);
  const [pendingAction, setPendingAction] = useState<
    "activate" | "assign" | "create" | "end" | null
  >(null);
  const [createNotice, setCreateNotice] = useState<ActionNotice>(null);
  const [assignmentNotice, setAssignmentNotice] = useState<ActionNotice>(null);
  const [activationNotice, setActivationNotice] = useState<ActionNotice>(null);
  const [endNotice, setEndNotice] = useState<ActionNotice>(null);
  const [task, setTask] = useState<"overview" | "create" | "assign" | "activate" | "end" | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState<ActionNotice>(null);
  const selectedBlock = blocks.find((block) => block.id === selectedBlockId);
  const taskGuard = useRef({ dirty, pendingAction });
  taskGuard.current = { dirty, pendingAction };

  useEffect(() => setBlocks(initialBlocks), [initialBlocks]);
  useEffect(() => setCircles(initialCircles), [initialCircles]);

  useEffect(() => {
    function readTask() {
      if (taskGuard.current.dirty || taskGuard.current.pendingAction) return;
      const hash = window.location.hash;
      if (hash === "#create-block") { setSelectedBlockId(null); setTask("create"); }
      else if (hash === "#assign-block-circle") { setSelectedBlockId(null); setTask("assign"); }
      else if (hash.startsWith("#manage-block-")) { setSelectedBlockId(hash.slice("#manage-block-".length)); setTask("overview"); }
    }
    readTask();
    window.addEventListener("hashchange", readTask);
    window.addEventListener("popstate", readTask);
    return () => { window.removeEventListener("hashchange", readTask); window.removeEventListener("popstate", readTask); };
  }, []);

  function closeTask() {
    if (pendingAction) return;
    setTask(null); setDirty(false);
    setCreateNotice(null); setAssignmentNotice(null); setActivationNotice(null); setEndNotice(null);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${selectedBlock ? `#block-${selectedBlock.id}` : ""}`);
  }
  function finishAction(message: string, blockId?: string) {
    setWorkspaceNotice({ kind: "success", text: message }); setTask(null); setDirty(false);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${blockId ? `#block-${blockId}` : ""}`);
  }

  const acceptingBlocks = blocks.filter(
    (block) => block.status === "forming" || block.status === "active",
  );
  const availableCircles = circles.filter(
    (circle) =>
      !circle.blockId && (circle.status === "forming" || circle.status === "active"),
  );
  const activatableBlocks = blocks.filter(
    (block) => block.status === "forming" && block.currentCircles >= 2,
  );
  const assignedCircles = circles.filter((circle) => Boolean(circle.blockId) && (!selectedBlockId || circle.blockId === selectedBlockId));

  async function submitBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingAction) return;
    if (preview) { setCreateNotice({ kind: "success", text: "Preview only — no Block or Circle was changed." }); return; }
    setPendingAction("create");
    setCreateNotice(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") ?? "");

    try {
      const result = await postJson<{ block: OpsActionBlock }>("/api/ops/blocks", { name });
      setBlocks((current) => [...current, result.block]);
      setCreateNotice({ kind: "success", text: `${result.block.name} created in forming state.` });
      formElement.reset();
      router.refresh();
      finishAction(`${result.block.name} created. Manage the Block to add its Circles.`, result.block.id);
    } catch (error) {
      setCreateNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Block could not be created.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingAction) return;
    if (preview) { setAssignmentNotice({ kind: "success", text: "Preview only — no Block or Circle was changed." }); return; }
    setPendingAction("assign");
    setAssignmentNotice(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const blockId = String(form.get("blockId") ?? "");
    const circleId = String(form.get("circleId") ?? "");
    const block = blocks.find((candidate) => candidate.id === blockId);
    const circle = circles.find((candidate) => candidate.id === circleId);

    try {
      if ((selectedBlockId && selectedBlockId !== blockId) || !acceptingBlocks.some((item) => item.id === blockId) || !availableCircles.some((item) => item.id === circleId)) throw new Error("Choose an available Circle and a current Block.");
      const result = await postJson<{ assignment: { created: boolean } }>(
        "/api/ops/block-assignments",
        { blockId, circleId },
      );
      if (result.assignment.created && block && circle) {
        setBlocks((current) => current.map((candidate) =>
          candidate.id === blockId
            ? {
                ...candidate,
                circles: [
                  ...candidate.circles,
                  { id: circle.id, name: circle.name, status: circle.status },
                ],
                currentCircles: candidate.currentCircles + 1,
              }
            : candidate,
        ));
        setCircles((current) => current.map((candidate) =>
          candidate.id === circleId
            ? {
                ...candidate,
                blockId,
                blockName: block.name,
                blockStatus: block.status,
              }
            : candidate,
        ));
      }
      setAssignmentNotice({
        kind: "success",
        text: result.assignment.created
          ? `${circle?.name ?? "Circle"} assigned to ${block?.name ?? "Block"}.`
          : `${circle?.name ?? "Circle"} is already assigned to ${block?.name ?? "Block"}.`,
      });
      formElement.reset();
      router.refresh();
      finishAction(`${circle?.name ?? "Circle"} assigned to ${block?.name ?? "Block"}.`, blockId);
    } catch (error) {
      setAssignmentNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Circle could not be assigned.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function submitActivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingAction) return;
    if (preview) { setActivationNotice({ kind: "success", text: "Preview only — no Block or Circle was changed." }); return; }
    setPendingAction("activate");
    setActivationNotice(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const blockId = String(form.get("blockId") ?? "");
    const block = blocks.find((candidate) => candidate.id === blockId);

    try {
      if ((selectedBlockId && selectedBlockId !== blockId) || !activatableBlocks.some((item) => item.id === blockId)) throw new Error("Choose a forming Block with at least two current Circles.");
      const result = await postJson<{
        block: OpsActionBlock & { activated: boolean };
      }>("/api/ops/blocks", { blockId }, "PATCH");
      setBlocks((current) => current.map((candidate) =>
        candidate.id === blockId ? { ...candidate, status: "active" } : candidate,
      ));
      setCircles((current) => current.map((candidate) =>
        candidate.blockId === blockId ? { ...candidate, blockStatus: "active" } : candidate,
      ));
      setActivationNotice({
        kind: "success",
        text: result.block.activated
          ? `${block?.name ?? "Block"} is active.`
          : `${block?.name ?? "Block"} is already active.`,
      });
      formElement.reset();
      router.refresh();
      finishAction(`${block?.name ?? "Block"} is active.`, blockId);
    } catch (error) {
      setActivationNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Block could not be activated.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function submitEndAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingAction) return;
    if (preview) { setEndNotice({ kind: "success", text: "Preview only — no Block or Circle was changed." }); return; }
    setPendingAction("end");
    setEndNotice(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const circleId = String(form.get("circleId") ?? "");
    const circle = circles.find((candidate) => candidate.id === circleId);

    try {
      if (!circle?.blockId || (selectedBlockId && circle.blockId !== selectedBlockId)) throw new Error("Choose a Circle currently assigned to this Block.");
      const result = await postJson<{
        assignment: {
          blockId: string;
          blockStatus: OpsActionBlock["status"];
          circleId: string;
        };
      }>("/api/ops/block-assignments", { circleId }, "PATCH");
      setBlocks((current) => current.map((candidate) =>
        candidate.id === result.assignment.blockId
          ? {
              ...candidate,
              circles: candidate.circles.filter((item) => item.id !== circleId),
              currentCircles: Math.max(0, candidate.currentCircles - 1),
              status: result.assignment.blockStatus,
            }
          : candidate,
      ));
      setCircles((current) => current.map((candidate) =>
        candidate.id === circleId
          ? { ...candidate, blockId: null, blockName: null, blockStatus: null }
          : candidate.blockId === result.assignment.blockId
            ? { ...candidate, blockStatus: result.assignment.blockStatus }
          : candidate,
      ));
      setEndNotice({
        kind: "success",
        text: result.assignment.blockStatus === "archived"
          ? `${circle?.name ?? "Circle"} no longer has a current Block assignment. The Block closed because fewer than two current Circles remain; all history stays recorded.`
          : `${circle?.name ?? "Circle"} no longer has a current Block assignment. Its history remains recorded.`,
      });
      formElement.reset();
      router.refresh();
      finishAction(result.assignment.blockStatus === "archived" ? `${circle.name} removed. The Block closed because fewer than two Circles remain; its history is preserved.` : `${circle.name} removed from the Block. Its history is preserved.`, result.assignment.blockId);
    } catch (error) {
      setEndNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Block assignment could not be ended.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  return <>
    {workspaceNotice ? <div className="mt-4"><Notice notice={workspaceNotice} /></div> : null}
    {task ? <OperatorDialog open title={task === "create" ? "New Block" : selectedBlock?.name ?? "Assign a Circle"} pending={pendingAction !== null} onClose={closeTask} returnFocusId={selectedBlockId ? `manage-block-trigger-${selectedBlockId}` : "new-block-trigger"}>
    <section key={task} className="space-y-5" aria-label="Block administration" data-operator-dirty={dirty ? "true" : undefined} data-operator-pending={pendingAction ? "true" : undefined} onChangeCapture={() => setDirty(true)}>
      {selectedBlockId && !selectedBlock ? <p role="alert" className="text-sm text-[var(--color-poster)]">This Block is no longer available. Close this window and choose a current Block.</p> : <>
      {selectedBlock && task !== "overview" ? <button className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-40" type="button" disabled={dirty || pendingAction !== null} onClick={() => setTask("overview")}>← Back to Block</button> : null}
      {task === "overview" && selectedBlock ? <>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm capitalize text-black/55">{selectedBlock.status} · {selectedBlock.currentCircles} {selectedBlock.currentCircles === 1 ? "Circle" : "Circles"}</p>{acceptingBlocks.some((block) => block.id === selectedBlock.id) ? <button className={BUTTON_CLASS} onClick={() => setTask("assign")} type="button">Add a Circle</button> : null}</div>
        <div className="space-y-2">{selectedBlock.circles.length ? selectedBlock.circles.map((circle) => <Link className="flex min-h-14 items-center justify-between gap-4 rounded-[4px] bg-black/[0.035] px-4 text-sm font-semibold" href={`/ops/circles?circleId=${circle.id}`} key={circle.id}>{circle.name}<span aria-hidden="true">→</span></Link>) : <p className="rounded-[4px] bg-black/[0.035] p-5 text-sm text-black/55">No Circles assigned yet.</p>}</div>
        {selectedBlock.status === "forming" ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-black/55">{selectedBlock.currentCircles < 2 ? `Add ${2 - selectedBlock.currentCircles} more ${selectedBlock.currentCircles === 1 ? "Circle" : "Circles"} before activating.` : "Two or more Circles are assigned. Activate when the group is ready."}</p><button className={BUTTON_CLASS} disabled={selectedBlock.currentCircles < 2} onClick={() => setTask("activate")} type="button">Activate Block</button></div> : null}
        {assignedCircles.length ? <button className="min-h-11 text-sm text-[var(--color-poster)] underline underline-offset-4" onClick={() => setTask("end")} type="button">Remove a Circle</button> : null}
      </> : null}
      {task === "create" ? <section id="create-block" aria-label="Create Block">
        <p className="mb-4 text-sm text-black/55">Name the Block. You can add its Circles next.</p>
        <form className="grid gap-3" onSubmit={submitBlock}>
          <label className={OPERATOR_LABEL_CLASS} htmlFor="ops-block-name">
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Block name</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              className={INPUT_CLASS}
              disabled={pendingAction === "create"}
              id="ops-block-name"
              maxLength={80}
              minLength={2}
              name="name"
              placeholder="Block 01"
              required
            />
            <button className={BUTTON_CLASS} disabled={pendingAction === "create"} type="submit">
              {pendingAction === "create" ? "Creating" : "Create Block"}
            </button>
          </div>
          <Notice notice={createNotice} />
        </form>
      </section> : null}

      {task === "assign" ? <section id="assign-block-circle" aria-label="Assign a Circle">
        <p className="mb-4 text-sm text-black/55">Choose a Circle that is not already in a Block.</p>
        {!acceptingBlocks.length ? <p className="mb-4 text-sm text-[var(--color-poster)]">Create a Block before assigning a Circle.</p> : !availableCircles.length ? <p className="mb-4 text-sm text-[var(--color-poster)]">No available Circles. Create one, or remove a Circle from its current Block first.</p> : null}
        <form className="grid gap-3" onSubmit={submitAssignment}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Circle</span>
              <select className={INPUT_CLASS} defaultValue="" disabled={pendingAction === "assign" || availableCircles.length === 0} name="circleId" required>
                <option className="bg-[var(--color-bone)]" disabled value="">Choose Circle</option>
                {availableCircles.map((circle) => <option className="bg-[var(--color-bone)]" key={circle.id} value={circle.id}>{circle.name}</option>)}
              </select>
            </label>
            {selectedBlock ? <input name="blockId" type="hidden" value={selectedBlock.id} /> : <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Block</span>
              <select className={INPUT_CLASS} defaultValue="" disabled={pendingAction === "assign" || acceptingBlocks.length === 0} name="blockId" required>
                <option className="bg-[var(--color-bone)]" disabled value="">Choose Block</option>
                {acceptingBlocks.map((block) => <option className="bg-[var(--color-bone)]" key={block.id} value={block.id}>{block.name} · {block.currentCircles} Circles</option>)}
              </select>
            </label>}
          </div>
          <button className={`${BUTTON_CLASS} w-fit`} disabled={pendingAction === "assign" || availableCircles.length === 0 || acceptingBlocks.length === 0} type="submit">
            {pendingAction === "assign" ? "Assigning" : "Assign Circle"}
          </button>
          <Notice notice={assignmentNotice} />
        </form>
      </section> : null}

      {task === "activate" ? <section aria-label="Activate Block">
        <p className="mb-4 text-sm text-black/55">Activate {selectedBlock?.name ?? "this Block"}? At least two current Circles are required. Foundations requirements stay the same.</p>
        <form className="grid gap-3" onSubmit={submitActivation}>
          {selectedBlock ? <input name="blockId" type="hidden" value={selectedBlock.id} /> : <label className={OPERATOR_LABEL_CLASS}>
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Forming Block</span>
            <select className={INPUT_CLASS} defaultValue="" disabled={pendingAction === "activate" || activatableBlocks.length === 0} name="blockId" required>
              <option className="bg-[var(--color-bone)]" disabled value="">Choose forming Block</option>
              {activatableBlocks.map((block) => <option className="bg-[var(--color-bone)]" key={block.id} value={block.id}>{block.name} · {block.currentCircles} Circles</option>)}
            </select>
          </label>}
          <button className={`${BUTTON_CLASS} w-fit`} disabled={pendingAction === "activate" || activatableBlocks.length === 0} type="submit">
            {pendingAction === "activate" ? "Activating" : "Activate Block"}
          </button>
          <Notice notice={activationNotice} />
        </form>
      </section> : null}

      {task === "end" ? <section aria-label="Remove a Circle">
        <p className="mb-4 max-w-md text-sm leading-relaxed text-black/55">
          End only the current relationship. If fewer than two current Circles remain, the Block closes while its full history stays intact.
        </p>
        <form className="grid gap-3" onSubmit={submitEndAssignment}>
          <label className={OPERATOR_LABEL_CLASS}>
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Assigned Circle</span>
            <select className={INPUT_CLASS} defaultValue="" disabled={pendingAction === "end" || assignedCircles.length === 0} name="circleId" required>
              <option className="bg-[var(--color-bone)]" disabled value="">Choose assigned Circle</option>
              {assignedCircles.map((circle) => <option className="bg-[var(--color-bone)]" key={circle.id} value={circle.id}>{circle.name} · {circle.blockName}</option>)}
            </select>
          </label>
          <button className={`${BUTTON_CLASS} w-fit`} disabled={pendingAction === "end" || assignedCircles.length === 0} type="submit">
            {pendingAction === "end" ? "Removing" : "Remove Circle"}
          </button>
          <Notice notice={endNotice} />
        </form>
      </section> : null}
      </>}
    </section>
    </OperatorDialog> : null}
  </>;
}
