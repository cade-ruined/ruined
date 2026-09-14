"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import OperatorAccessEditor from "@/components/platform/OperatorAccessEditor";

import {
  OPERATOR_BUTTON_CLASS,
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
} from "@/components/platform/operatorStyles";
import { keepFocusInside } from "@/lib/accessibility/focus";
import type {
  OperatorAccessCircle,
  OperatorAccessEntry,
  OperatorAccessRole,
} from "@/lib/platform/ops-access-repository";

type Notice = { kind: "error" | "success"; text: string } | null;

export type OperatorAccessSelectedMember = {
  displayName: string;
  email: string | null;
  memberId: string;
};

type OperatorAccessMemberSearch = {
  members: OperatorAccessSelectedMember[];
  page: number;
  pageCount: number;
  query: string;
  totalResults: number;
};

function memberSearchHref(query: string, page: number) {
  const params = new URLSearchParams({ chooseMember: "1", memberQuery: query, memberPage: String(page) });
  return `/ops/operators?${params.toString()}#choose-operator-member`;
}

function matchingOperator(operators: OperatorAccessEntry[], member: OperatorAccessSelectedMember | null) {
  const email = member?.email?.trim().toLowerCase();
  return email ? operators.find((entry) => entry.email.trim().toLowerCase() === email) : undefined;
}

const ROLE_COPY: Record<OperatorAccessRole, { label: string; summary: string }> = {
  guide: {
    label: "Guide",
    summary: "Supports selected Circles, their members, work, and Experiences.",
  },
  circle_leader: {
    label: "Shaper",
    summary: "Leads selected Circles and the member experience inside them.",
  },
  ops_admin: {
    label: "Administrator",
    summary: "Full access to members, programs, systems, and other operators.",
  },
};

function roleLabel(role: OperatorAccessRole): string {
  return ROLE_COPY[role].label;
}

function statusLabel(status: OperatorAccessEntry["status"]): string {
  if (status === "active") return "Active";
  if (status === "invited") return "Invitation pending";
  if (status === "expired") return "Invitation expired";
  return "Access suspended";
}

function statusTone(status: OperatorAccessEntry["status"]): string {
  if (status === "active") return "bg-[var(--color-verdigris)]";
  if (status === "invited") return "bg-[var(--color-shop)]";
  return "bg-[var(--color-poster)]";
}

function formatDate(value: string | null): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

async function requestJson<T>(
  body: Record<string, unknown>,
  method: "DELETE" | "POST",
): Promise<T> {
  const response = await fetch("/api/ops/operators", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
  const payload = (await response.json().catch(() => null)) as ({ error?: unknown } & T) | null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "The action could not be completed.");
  }
  if (!payload) throw new Error("The action did not return a result.");
  return payload;
}

function OperatorStatus({ status }: { status: OperatorAccessEntry["status"] }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium text-black/70">
      <span aria-hidden="true" className={`size-2 rounded-full ${statusTone(status)}`} />
      {statusLabel(status)}
    </span>
  );
}

function OperatorScope({ circles, role }: { circles: OperatorAccessCircle[]; role: OperatorAccessRole }) {
  if (role === "ops_admin") return <span>All areas · no Circle required</span>;
  if (circles.length === 0) return <span className="text-[var(--color-poster)]">No Circles to manage</span>;
  return <span>{circles.map((circle) => circle.name).join(", ")}</span>;
}

export default function OperatorAccessManager({
  circles,
  currentViewerAuthUserId,
  initialOperators,
  initialAddOpen = false,
  initialMemberPickerOpen = false,
  memberSearch,
  preview,
  selectedMember = null,
}: {
  circles: OperatorAccessCircle[];
  currentViewerAuthUserId: string | null;
  initialOperators: OperatorAccessEntry[];
  initialAddOpen?: boolean;
  initialMemberPickerOpen?: boolean;
  memberSearch?: OperatorAccessMemberSearch;
  preview: boolean;
  selectedMember?: OperatorAccessSelectedMember | null;
}) {
  const router = useRouter();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addTriggerRef = useRef<HTMLButtonElement | null>(null);
  const addDialogRef = useRef<HTMLElement>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const confirmDialogRef = useRef<HTMLElement>(null);
  const confirmationTriggerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const firstRoleRef = useRef<HTMLInputElement>(null);
  const memberSearchRef = useRef<HTMLInputElement>(null);
  const memberPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const submissionRef = useRef(false);
  const initialExistingOperator = matchingOperator(initialOperators, selectedMember);
  const initialReview = selectedMember?.email && !initialExistingOperator ? selectedMember : null;
  const [operators, setOperators] = useState(initialOperators);
  const [addOpen, setAddOpen] = useState(Boolean(initialReview) || (initialAddOpen && !selectedMember));
  const [memberPickerOpen, setMemberPickerOpen] = useState(initialMemberPickerOpen);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [pageNotice, setPageNotice] = useState<Notice>(null);
  const [query, setQuery] = useState(initialExistingOperator?.email ?? "");
  const [roleFilter, setRoleFilter] = useState<"all" | OperatorAccessRole>("all");
  const [role, setRole] = useState<OperatorAccessRole>("guide");
  const [resendEmail, setResendEmail] = useState<string | null>(null);
  const [reviewedMember, setReviewedMember] = useState<OperatorAccessSelectedMember | null>(initialReview);
  const [prefill, setPrefill] = useState<{ displayName: string; email: string } | null>(
    initialReview?.email ? { displayName: initialReview.displayName, email: initialReview.email } : null,
  );
  const [selectedCircleIds, setSelectedCircleIds] = useState<string[]>([]);
  const [adminConfirmed, setAdminConfirmed] = useState(false);
  const [confirming, setConfirming] = useState<OperatorAccessEntry | null>(null);
  const [editing, setEditing] = useState<OperatorAccessEntry | null>(null);

  useEffect(() => setOperators(initialOperators), [initialOperators]);

  useEffect(() => {
    if (!memberPickerOpen) return;
    const timeout = window.setTimeout(() => memberSearchRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [memberPickerOpen]);

  useEffect(() => {
    if (!addOpen) return;
    const timeout = window.setTimeout(() => (reviewedMember ? firstRoleRef : firstFieldRef).current?.focus(), 0);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pending) return;
        setAddOpen(false);
        setNotice(null);
        window.setTimeout(() => (addTriggerRef.current ?? addButtonRef.current)?.focus(), 0);
        return;
      }
      keepFocusInside(event, addDialogRef.current);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [addOpen, pending, reviewedMember]);

  useEffect(() => {
    if (!confirming) return;
    const timeout = window.setTimeout(() => confirmCancelRef.current?.focus(), 0);
    const manageDialogKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirming(null);
        window.setTimeout(() => confirmationTriggerRef.current?.focus(), 0);
        return;
      }
      keepFocusInside(event, confirmDialogRef.current);
    };
    document.addEventListener("keydown", manageDialogKeyboard);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("keydown", manageDialogKeyboard);
    };
  }, [confirming]);

  const counts = useMemo(() => ({
    active: operators.filter((entry) => entry.status === "active").length,
    attention: operators.filter((entry) => entry.status === "expired" || entry.status === "suspended").length,
    invited: operators.filter((entry) => entry.status === "invited").length,
    total: operators.length,
  }), [operators]);

  const filteredOperators = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return operators.filter((entry) => {
      if (roleFilter !== "all" && entry.role !== roleFilter) return false;
      if (!normalized) return true;
      return [
        entry.displayName,
        entry.email,
        roleLabel(entry.role),
        ...entry.circles.map((circle) => circle.name),
      ].some((value) => value.toLowerCase().includes(normalized));
    });
  }, [operators, query, roleFilter]);

  const selectedOperator = matchingOperator(operators, selectedMember);

  function findOperator(entry: OperatorAccessEntry) {
    setQuery(entry.email);
    setRoleFilter("all");
    window.setTimeout(() => {
      const row = document.getElementById(`operator-row-${entry.id}`);
      row?.scrollIntoView({ block: "nearest", behavior: "instant" });
      row?.focus({ preventScroll: true });
    }, 0);
  }

  function openMemberPicker() {
    if (pending) return;
    setAddOpen(false);
    setMemberPickerOpen(true);
    window.setTimeout(() => memberSearchRef.current?.focus(), 0);
  }

  function closeAddOperator() {
    setAddOpen(false);
    setResendEmail(null);
    setReviewedMember(null);
    setPrefill(null);
    setNotice(null);
    window.setTimeout(() => (addTriggerRef.current ?? addButtonRef.current)?.focus(), 0);
  }

  function openAddOperator(entry?: OperatorAccessEntry, member?: OperatorAccessSelectedMember) {
    setRole(entry?.role ?? "guide");
    setResendEmail(entry?.email ?? null);
    setSelectedCircleIds(entry?.circles.map((circle) => circle.id) ?? []);
    setAdminConfirmed(false);
    setReviewedMember(member ?? null);
    setPrefill(entry ?? (member?.email ? { displayName: member.displayName, email: member.email } : null));
    setNotice(null);
    setAddOpen(true);
  }

  async function submitOperator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionRef.current) return;
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();

    if (!resendEmail && operators.some((entry) => entry.email.trim().toLowerCase() === email.toLowerCase())) {
      setNotice({ kind: "error", text: "This email already has an operator record. Close this review and find their record; use Send again only to replace a pending invitation." });
      return;
    }

    if (role !== "ops_admin" && selectedCircleIds.length === 0) {
      setNotice({ kind: "error", text: "Choose at least one Circle." });
      return;
    }
    if (role === "ops_admin" && !adminConfirmed) {
      setNotice({ kind: "error", text: "Confirm the administrator access shown below." });
      return;
    }

    submissionRef.current = true;
    setPending(true);
    setNotice(null);
    try {
      let payload: {
        delivery: "not_sent" | "sent";
        invitation: { entry: OperatorAccessEntry; expiresAt: string; reissued: boolean };
      };
      if (preview) {
        payload = {
          delivery: "sent",
          invitation: {
            entry: {
              authUserId: null,
              circles: circles.filter((circle) => selectedCircleIds.includes(circle.id)),
              displayName,
              email: email.toLowerCase(),
              id: `preview-invitation:${Date.now()}`,
              invitedAt: new Date().toISOString(),
              lastSignedInAt: null,
              role,
              status: "invited",
            },
            expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            reissued: false,
          },
        };
      } else {
        payload = await requestJson<{
          delivery: "not_sent" | "sent";
          invitation: { entry: OperatorAccessEntry; expiresAt: string; reissued: boolean };
        }>({
          circleIds: role === "ops_admin" ? [] : selectedCircleIds,
          displayName,
          email,
          role,
        }, "POST");
      }

      setOperators((current) => [
        payload.invitation.entry,
        ...current.filter((entry) => entry.email !== payload.invitation.entry.email),
      ]);
      setPageNotice({
        kind: payload.delivery === "sent" ? "success" : "error",
        text: payload.delivery === "sent"
          ? preview
            ? `Preview invitation created for ${payload.invitation.entry.email}. No email was sent.`
            : `Invitation sent to ${payload.invitation.entry.email}. Access is pending until they return to /access and verify their code, or continue with their existing signed-in account.`
          : `Invitation saved for ${payload.invitation.entry.displayName}, but the email was not delivered. Access is still pending. Use Send again from their row.`,
      });
      formRef.current?.reset();
      setSelectedCircleIds([]);
      setRole("guide");
      setAdminConfirmed(false);
      closeAddOperator();
      if (!preview) router.refresh();
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The invitation could not be sent.",
      });
    } finally {
      submissionRef.current = false;
      setPending(false);
    }
  }

  async function removeEntry(entry: OperatorAccessEntry) {
    setPending(true);
    setPageNotice(null);
    try {
      if (!preview) {
        await requestJson(
          entry.authUserId ? { authUserId: entry.authUserId } : { email: entry.email },
          "DELETE",
        );
      }
      setOperators((current) => current.filter((candidate) => candidate.id !== entry.id));
      setPageNotice({
        kind: "success",
        text: entry.authUserId
          ? `${entry.displayName}'s operator access was removed.`
          : `${entry.displayName}'s invitation was revoked.`,
      });
      setConfirming(null);
      if (!preview) router.refresh();
    } catch (error) {
      setPageNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The access change could not be completed.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-6">
        <p className="max-w-lg text-sm leading-relaxed text-black/60">Invite someone to help run Ruined. Choose an existing member or add someone by email.</p>
        <div className="flex flex-wrap items-center gap-4">
          <button aria-controls="choose-operator-member" aria-expanded={memberPickerOpen} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" onClick={openMemberPicker} ref={memberPickerTriggerRef} type="button">Choose existing member</button>
        <button
          className={OPERATOR_BUTTON_CLASS}
          onClick={(event) => {
            addTriggerRef.current = event.currentTarget;
            openAddOperator();
          }}
          ref={addButtonRef}
          type="button"
        >
          Add operator
        </button>
        </div>
      </header>

      {memberPickerOpen && memberSearch ? (
        <section aria-labelledby="choose-operator-member-title" className="mt-6 rounded-[4px] bg-black/[0.035] p-4 sm:p-5" id="choose-operator-member">
          <div className="flex items-center justify-between gap-4">
            <h2 className="ui-heading text-xl font-semibold" id="choose-operator-member-title">Choose a member</h2>
            <button className="min-h-11 text-sm underline underline-offset-4" onClick={() => {
              setMemberPickerOpen(false);
              memberPickerTriggerRef.current?.focus();
            }} type="button">Close member search</button>
          </div>
          <form action="/ops/operators#choose-operator-member" className="mt-4 flex flex-wrap items-end gap-3" method="get">
            <input name="chooseMember" type="hidden" value="1" />
            <label className="min-w-0 flex-1 basis-48" htmlFor="operator-member-search">
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Find by name or email</span>
              <input className={OPERATOR_FIELD_CLASS} defaultValue={memberSearch.query} id="operator-member-search" key={memberSearch.query} maxLength={120} name="memberQuery" placeholder="Name or email" ref={memberSearchRef} type="search" />
            </label>
            <button className={OPERATOR_BUTTON_CLASS} type="submit">Find member</button>
          </form>
          <p aria-live="polite" className="mt-4 text-sm text-black/55">{memberSearch.totalResults} {memberSearch.totalResults === 1 ? "member" : "members"} found. Choosing someone only opens a review; it does not send an invitation.</p>
          <ul className="mt-3 space-y-2">
            {memberSearch.members.map((member) => {
              const existing = matchingOperator(operators, member);
              return (
                <li className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 rounded-[4px] bg-[var(--color-bone)] px-4 py-3" key={member.memberId}>
                  <div className="min-w-0">
                    <p className="ui-heading font-semibold">{member.displayName}</p>
                    <p className="break-all text-sm text-black/60">{member.email ?? "No email saved"}</p>
                    {existing ? <div className="mt-1"><OperatorStatus status={existing.status} /> <span className="text-sm text-black/60">· {roleLabel(existing.role)}</span></div> : null}
                  </div>
                  {existing ? (
                    <button aria-label={`View operator record for ${member.displayName}`} className="min-h-11 text-sm font-medium underline underline-offset-4" onClick={() => findOperator(existing)} type="button">View operator record</button>
                  ) : member.email ? (
                    <button aria-label={`Review access for ${member.displayName}`} className="min-h-11 text-sm font-medium underline underline-offset-4" onClick={(event) => {
                      addTriggerRef.current = event.currentTarget;
                      openAddOperator(undefined, member);
                    }} type="button">Review access</button>
                  ) : (
                    <Link className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={`/ops/members/${encodeURIComponent(member.memberId)}#membership`}>Add email on member record</Link>
                  )}
                </li>
              );
            })}
          </ul>
          {memberSearch.totalResults === 0 ? <p className="mt-4 text-sm text-black/60">No members match. Try another name or email, or use Add operator to invite someone new.</p> : null}
          {memberSearch.pageCount > 1 ? (
            <nav aria-label="Member search pages" className="mt-4 flex flex-wrap items-center gap-5 text-sm">
              {memberSearch.page > 1 ? <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={memberSearchHref(memberSearch.query, memberSearch.page - 1)}>Previous members</Link> : null}
              <span>Page {memberSearch.page} of {memberSearch.pageCount}</span>
              {memberSearch.page < memberSearch.pageCount ? <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={memberSearchHref(memberSearch.query, memberSearch.page + 1)}>Next members</Link> : null}
            </nav>
          ) : null}
        </section>
      ) : null}

      {selectedMember ? (
        <section aria-labelledby="selected-operator-member" className="mt-6 rounded-[4px] bg-[var(--color-shop)]/35 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className={OPERATOR_LABEL_TEXT_CLASS}>From member record</p>
              <h3 className="ui-heading mt-2 text-xl font-semibold" id="selected-operator-member">{selectedMember.displayName}</h3>
              <p className="mt-1 break-all text-sm text-black/60">{selectedMember.email ?? "No email saved"}</p>
            </div>
            <Link className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={`/ops/members/${encodeURIComponent(selectedMember.memberId)}`}>
              Back to member
            </Link>
          </div>
          {selectedOperator ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
              <OperatorStatus status={selectedOperator.status} />
              <span className="text-sm">{roleLabel(selectedOperator.role)}</span>
              <button className="min-h-11 text-sm font-medium underline underline-offset-4" onClick={() => findOperator(selectedOperator)} type="button">Find operator record</button>
              <p className="basis-full text-sm text-black/60">
                {selectedOperator.status === "active"
                  ? "This member already has operator access. Their member Circle placement is separate."
                  : selectedOperator.authUserId
                    ? "This account has suspended operator access. Review the existing record before making a new invitation."
                    : "An invitation already exists. Use its row to review or send it again; a second invitation is not needed."}
              </p>
            </div>
          ) : selectedMember.email ? (
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <button className={OPERATOR_BUTTON_CLASS} onClick={(event) => {
                addTriggerRef.current = event.currentTarget;
                openAddOperator(undefined, selectedMember);
              }} type="button">Review operator access</button>
              <p className="max-w-xl text-sm text-black/60">Choose a responsibility, then send an invitation. Operator access starts only after you send it and they accept.</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-poster)]">Add an email on this member’s record before inviting them as an operator.</p>
          )}
        </section>
      ) : null}

      <dl aria-label="Operator access snapshot" className="mt-8 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          ["Active", counts.active],
          ["Invited", counts.invited],
          ["Needs attention", counts.attention],
          ["Total", counts.total],
        ].map(([label, value], index) => (
          <div
            className={`rounded-[4px] px-4 py-5 ${index === 0 ? "bg-[var(--color-verdigris)] text-white" : "bg-black/[0.035]"}`}
            key={label}
          >
            <dt className={`text-xs ${index === 0 ? "text-white/66" : "text-black/46"}`}>{label}</dt>
            <dd className="mt-3 font-[var(--font-display)] text-4xl leading-none">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <label>
          <span className="sr-only">Search operators</span>
          <input
            className={`${OPERATOR_FIELD_CLASS} mt-0 bg-black/[0.035]`}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email, role, or Circle"
            type="search"
            value={query}
          />
        </label>
        <label>
          <span className="sr-only">Filter by responsibility</span>
          <select
            className={`${OPERATOR_FIELD_CLASS} mt-0 bg-black/[0.035]`}
            onChange={(event) => setRoleFilter(event.target.value as "all" | OperatorAccessRole)}
            value={roleFilter}
          >
            <option value="all">Every responsibility</option>
            <option value="ops_admin">Administrators</option>
            <option value="circle_leader">Shapers</option>
            <option value="guide">Guides</option>
          </select>
        </label>
      </div>

      <p
        aria-live="polite"
        className={`mt-4 min-h-5 text-sm ${pageNotice?.kind === "error" ? "text-[var(--color-poster)]" : "text-black/55"}`}
        role={pageNotice?.kind === "error" ? "alert" : "status"}
      >
        {pageNotice?.text ?? " "}
      </p>

      <div className="mt-2" role="list" aria-label="Operators">
        <div className="hidden grid-cols-[minmax(12rem,1.25fr)_10rem_minmax(11rem,0.9fr)_11rem_7rem] gap-4 px-4 pb-3 text-sm font-medium text-black/55 xl:grid">
          <span>Operator</span>
          <span>Responsibility</span>
          <span>Areas they manage</span>
          <span>Status</span>
          <span className="sr-only">Actions</span>
        </div>
        <div className="space-y-2">
          {filteredOperators.map((entry) => (
            <article
              className="grid gap-4 rounded-[4px] bg-black/[0.035] px-4 py-5 transition-colors hover:bg-black/[0.06] md:grid-cols-2 xl:grid-cols-[minmax(12rem,1.25fr)_10rem_minmax(11rem,0.9fr)_11rem_7rem] xl:items-center"
              key={entry.id}
              id={`operator-row-${entry.id}`}
              role="listitem"
              tabIndex={-1}
            >
              <div className="min-w-0 md:col-span-2 xl:col-span-1">
                <h2 className="ui-heading truncate text-base font-semibold">{entry.displayName}</h2>
                <p className="mt-1 truncate text-sm text-black/48">{entry.email}</p>
              </div>
              <div>
                <p className="text-xs text-black/42 xl:hidden">Responsibility</p>
                <p className="mt-1 text-sm font-medium xl:mt-0">{roleLabel(entry.role)}</p>
              </div>
              <div>
                <p className="text-xs text-black/42 xl:hidden">Areas they manage</p>
                <p className="mt-1 text-sm text-black/62 xl:mt-0"><OperatorScope circles={entry.circles} role={entry.role} /></p>
              </div>
              <div>
                <OperatorStatus status={entry.status} />
                <p className="mt-1 text-xs text-black/42">
                  {entry.status === "active" ? `Last active ${formatDate(entry.lastSignedInAt)}` : `Invitation created ${formatDate(entry.invitedAt)}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-4 xl:justify-end">
                {entry.authUserId && entry.authUserId !== currentViewerAuthUserId ? <button className="min-h-11 text-sm font-semibold underline decoration-black/25 underline-offset-4" onClick={() => setEditing(entry)} type="button">Edit access</button> : null}
                {!entry.authUserId ? (
                  <button
                    className="min-h-11 text-sm font-medium underline decoration-black/25 underline-offset-4 hover:text-[var(--color-poster)]"
                    onClick={(event) => {
                      addTriggerRef.current = event.currentTarget;
                      openAddOperator(entry);
                    }}
                    type="button"
                  >
                    Send again
                  </button>
                ) : null}
                {entry.authUserId !== currentViewerAuthUserId ? (
                  <button
                    className="min-h-11 text-sm text-black/48 underline decoration-black/20 underline-offset-4 hover:text-[var(--color-poster)]"
                    onClick={(event) => {
                      confirmationTriggerRef.current = event.currentTarget;
                      setConfirming(entry);
                    }}
                    type="button"
                  >
                    {entry.authUserId ? "Remove" : "Revoke"}
                  </button>
                ) : (
                  <span className="text-xs text-black/38">You</span>
                )}
              </div>
            </article>
          ))}
          {filteredOperators.length === 0 ? (
            <p className="rounded-[4px] bg-black/[0.035] px-5 py-12 text-center text-sm text-black/50">
              No operators match those filters.
            </p>
          ) : null}
        </div>
      </div>

      {editing ? <OperatorAccessEditor entry={editing} circles={circles} preview={preview} onClose={() => setEditing(null)} onSaved={(updated) => {
        setOperators((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
        setPageNotice({ kind: "success", text: `${updated.displayName}’s operator access was updated.` });
        setEditing(null);
        router.refresh();
      }} /> : null}
      {addOpen ? (
        <div className="fixed inset-0 z-[160] flex justify-end bg-black/55" role="presentation" onMouseDown={(event) => {
          if (!pending && event.currentTarget === event.target) closeAddOperator();
        }}>
          <aside
            aria-labelledby="add-operator-title"
            aria-modal="true"
            className="h-full w-full overflow-y-auto bg-[var(--color-bone)] px-5 py-6 shadow-[-12px_0_0_rgba(0,0,0,0.18)] sm:max-w-[34rem] sm:px-8 sm:py-8"
            ref={addDialogRef}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-5">
              <div>
                <h2 className="mt-2 font-[var(--font-display)] text-4xl leading-none" id="add-operator-title">
                  {resendEmail ? "Send again" : reviewedMember ? "Review access" : "Add operator"}
                </h2>
              </div>
              <button
                aria-label="Close add operator"
                className="inline-flex size-12 items-center justify-center rounded-full border border-black/20 text-2xl hover:border-black"
                disabled={pending}
                onClick={closeAddOperator}
                type="button"
              >
                ×
              </button>
            </div>

            <p className="mt-5 text-sm leading-relaxed text-black/60">
              Choose their responsibility, then send the invitation. They open member sign-in to accept and, if asked, verify the newest email code.
            </p>
            {!reviewedMember && !resendEmail && memberSearch ? <button className="mt-3 min-h-11 text-sm underline underline-offset-4" disabled={pending} onClick={openMemberPicker} type="button">Already a member? Find their account</button> : null}

            <form className="mt-8 space-y-7" onSubmit={submitOperator} ref={formRef}>
              <label className={OPERATOR_LABEL_CLASS} htmlFor="operator-display-name">
                <span className={OPERATOR_LABEL_TEXT_CLASS}>Full name</span>
                <input
                  autoComplete="name"
                  className={OPERATOR_FIELD_CLASS}
                  disabled={pending}
                  defaultValue={prefill?.displayName ?? ""}
                  id="operator-display-name"
                  maxLength={120}
                  name="displayName"
                  ref={firstFieldRef}
                  readOnly={Boolean(reviewedMember)}
                  required
                  type="text"
                />
              </label>

              <label className={OPERATOR_LABEL_CLASS} htmlFor="operator-email">
                <span className={OPERATOR_LABEL_TEXT_CLASS}>Email</span>
                <input
                  aria-describedby={resendEmail ? "operator-email-resend-note" : reviewedMember ? "operator-member-note" : undefined}
                  autoComplete="email"
                  className={`${OPERATOR_FIELD_CLASS} ${resendEmail ? "cursor-not-allowed bg-black/[0.05]" : ""}`}
                  disabled={pending}
                  defaultValue={prefill?.email ?? ""}
                  id="operator-email"
                  maxLength={254}
                  name="email"
                  readOnly={Boolean(resendEmail || reviewedMember)}
                  required
                  type="email"
                />
                {resendEmail ? (
                  <span className="mt-2 block text-xs leading-relaxed text-black/48" id="operator-email-resend-note">
                    The address is locked so the original invitation cannot stay active. Revoke it first to use a different email.
                  </span>
                ) : null}
                {reviewedMember ? (
                  <span className="mt-2 block text-xs leading-relaxed text-black/55" id="operator-member-note">
                    Using this member’s existing account. Their profile and member Circle stay unchanged.
                  </span>
                ) : null}
              </label>

              <fieldset>
                <legend className={OPERATOR_LABEL_TEXT_CLASS}>Responsibility</legend>
                <div className="mt-3 space-y-2">
                  {(Object.entries(ROLE_COPY) as Array<[OperatorAccessRole, (typeof ROLE_COPY)[OperatorAccessRole]]>).map(([value, copy]) => (
                    <label
                      className={`block cursor-pointer rounded-[4px] border px-4 py-4 transition-colors ${role === value ? "border-black bg-[var(--color-shop)]" : "border-black/15 bg-black/[0.025] hover:border-black/45"}`}
                      key={value}
                    >
                      <span className="flex items-start gap-3">
                        <input
                          checked={role === value}
                          className="mt-1 size-5 accent-black"
                          disabled={pending}
                          name="role"
                          ref={value === "guide" ? firstRoleRef : undefined}
                          onChange={() => {
                            setRole(value);
                            setSelectedCircleIds([]);
                            setAdminConfirmed(false);
                            setNotice(null);
                          }}
                          type="radio"
                          value={value}
                        />
                        <span>
                          <span className="ui-heading block text-base font-semibold">{copy.label}</span>
                          <span className="mt-1 block text-sm leading-relaxed text-black/55">{copy.summary}</span>
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {role !== "ops_admin" ? (
                <fieldset>
                  <legend className={OPERATOR_LABEL_TEXT_CLASS}>Circles they help manage</legend>
                  <p className="mt-2 text-sm text-black/50">Choose the Circles they will help run. This does not place them in a Circle as a member.</p>
                  {role === "circle_leader" ? <p className="mt-2 text-sm text-black/50">Each Circle can have one active or invited Shaper.</p> : null}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {circles.map((circle) => {
                      const checked = selectedCircleIds.includes(circle.id);
                      return (
                        <label
                          className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-[4px] border px-4 py-3 text-sm ${checked ? "border-black bg-[var(--color-shop)]" : "border-black/15 bg-black/[0.025]"}`}
                          key={circle.id}
                        >
                          <input
                            checked={checked}
                            className="size-5 accent-black"
                            disabled={pending}
                            onChange={() => setSelectedCircleIds((current) => checked
                              ? current.filter((id) => id !== circle.id)
                              : [...current, circle.id])}
                            type="checkbox"
                          />
                          {circle.name}
                        </label>
                      );
                    })}
                  </div>
                  {circles.length === 0 ? (
                    <p className="mt-3 rounded-[4px] bg-[var(--color-poster)]/[0.08] px-4 py-4 text-sm text-[var(--color-poster)]">
                      A Shaper or Guide needs a forming or active Circle. <Link className="underline underline-offset-4" href="/ops/circles">Open Circles</Link> to create one. Administrators do not need a Circle.
                    </p>
                  ) : null}
                </fieldset>
              ) : (
                <label className="flex cursor-pointer gap-3 rounded-[4px] bg-[var(--color-poster)]/[0.09] px-4 py-4 text-sm leading-relaxed">
                  <input
                    checked={adminConfirmed}
                    className="mt-0.5 size-5 shrink-0 accent-[var(--color-poster)]"
                    disabled={pending}
                    onChange={(event) => setAdminConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  <span>I understand this grants full access, including the ability to add or remove other operators. No Circle assignment is required.</span>
                </label>
              )}

              <p
                aria-live="polite"
                className={`min-h-5 text-sm ${notice?.kind === "error" ? "text-[var(--color-poster)]" : "text-black/52"}`}
                role={notice?.kind === "error" ? "alert" : "status"}
              >
                {notice?.text ?? " "}
              </p>

              <div className="flex flex-col-reverse gap-3 border-t border-black/10 pt-5 sm:flex-row sm:justify-end">
                <button
                  className="min-h-12 px-5 text-sm font-medium text-black/55 hover:text-black"
                  disabled={pending}
                  onClick={closeAddOperator}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className={OPERATOR_BUTTON_CLASS}
                  disabled={pending || (role !== "ops_admin" && selectedCircleIds.length === 0) || (role === "ops_admin" && !adminConfirmed)}
                  type="submit"
                >
                  {pending ? "Sending invitation" : resendEmail ? "Send again" : "Send invitation"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      {confirming ? (
        <div className="fixed inset-0 z-[170] grid place-items-center bg-black/60 px-4">
          <section
            aria-labelledby="operator-removal-title"
            aria-modal="true"
            className="w-full max-w-md rounded-[4px] bg-[var(--color-bone)] p-6 shadow-[10px_10px_0_rgba(208,49,45,0.9)] sm:p-8"
            ref={confirmDialogRef}
            role="dialog"
          >
            <h2 className="font-[var(--font-display)] text-3xl leading-none" id="operator-removal-title">
              {confirming.authUserId ? "Remove operator access?" : "Revoke invitation?"}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-black/58">
              {confirming.authUserId
                ? `${confirming.displayName} will immediately lose access to Ruined operations. Their member access, if any, stays intact.`
                : `${confirming.displayName} will no longer be able to claim this invitation.`}
            </p>
            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                className="min-h-12 px-5 text-sm font-medium text-black/55 hover:text-black"
                disabled={pending}
                onClick={() => {
                  setConfirming(null);
                  window.setTimeout(() => confirmationTriggerRef.current?.focus(), 0);
                }}
                ref={confirmCancelRef}
                type="button"
              >
                Cancel
              </button>
              <button
                className="ui-heading min-h-12 rounded-[4px] bg-[var(--color-poster)] px-5 text-sm font-semibold text-white disabled:opacity-50"
                disabled={pending}
                onClick={() => void removeEntry(confirming)}
                type="button"
              >
                {pending ? "Working" : confirming.authUserId ? "Remove operator" : "Revoke invitation"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
