"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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
  if (role === "ops_admin") return <span>Every area</span>;
  if (circles.length === 0) return <span className="text-[var(--color-poster)]">No Circle assigned</span>;
  return <span>{circles.map((circle) => circle.name).join(", ")}</span>;
}

export default function OperatorAccessManager({
  circles,
  currentViewerAuthUserId,
  initialOperators,
  preview,
}: {
  circles: OperatorAccessCircle[];
  currentViewerAuthUserId: string | null;
  initialOperators: OperatorAccessEntry[];
  preview: boolean;
}) {
  const router = useRouter();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addDialogRef = useRef<HTMLElement>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const confirmDialogRef = useRef<HTMLElement>(null);
  const confirmationTriggerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [operators, setOperators] = useState(initialOperators);
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [pageNotice, setPageNotice] = useState<Notice>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | OperatorAccessRole>("all");
  const [role, setRole] = useState<OperatorAccessRole>("guide");
  const [resendEmail, setResendEmail] = useState<string | null>(null);
  const [selectedCircleIds, setSelectedCircleIds] = useState<string[]>([]);
  const [adminConfirmed, setAdminConfirmed] = useState(false);
  const [confirming, setConfirming] = useState<OperatorAccessEntry | null>(null);

  useEffect(() => setOperators(initialOperators), [initialOperators]);

  useEffect(() => {
    if (!addOpen) return;
    const timeout = window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAddOpen(false);
        setNotice(null);
        window.setTimeout(() => addButtonRef.current?.focus(), 0);
        return;
      }
      keepFocusInside(event, addDialogRef.current);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [addOpen]);

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

  function closeAddOperator() {
    setAddOpen(false);
    setResendEmail(null);
    setNotice(null);
    window.setTimeout(() => addButtonRef.current?.focus(), 0);
  }

  function openAddOperator(entry?: OperatorAccessEntry) {
    setRole(entry?.role ?? "guide");
    setResendEmail(entry?.email ?? null);
    setSelectedCircleIds(entry?.circles.map((circle) => circle.id) ?? []);
    setAdminConfirmed(entry?.role === "ops_admin");
    setNotice(null);
    setAddOpen(true);
    window.setTimeout(() => {
      const form = formRef.current;
      if (form && entry) {
        const name = form.elements.namedItem("displayName");
        const email = form.elements.namedItem("email");
        if (name instanceof HTMLInputElement) name.value = entry.displayName;
        if (email instanceof HTMLInputElement) email.value = entry.email;
      }
    }, 0);
  }

  async function submitOperator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();

    if (role !== "ops_admin" && selectedCircleIds.length === 0) {
      setNotice({ kind: "error", text: "Choose at least one Circle." });
      return;
    }
    if (role === "ops_admin" && !adminConfirmed) {
      setNotice({ kind: "error", text: "Confirm the administrator access shown below." });
      return;
    }

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
            : `Invitation sent to ${payload.invitation.entry.email}.`
          : `${payload.invitation.entry.displayName} was added, but the email was not delivered. Use Send again from their row.`,
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
        <div>
          <p className="font-[var(--font-cadehandy2)] text-2xl leading-none text-[var(--color-poster)] [transform:rotate(-2deg)]">
            Team access
          </p>
          <h2 className="mt-2 font-[var(--font-display)] text-4xl leading-[0.9] tracking-[-0.035em] sm:text-5xl">
            Operators
          </h2>
        </div>
        <button
          className={OPERATOR_BUTTON_CLASS}
          onClick={() => openAddOperator()}
          ref={addButtonRef}
          type="button"
        >
          Add operator
        </button>
      </header>

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
        <div className="hidden grid-cols-[minmax(12rem,1.25fr)_10rem_minmax(11rem,0.9fr)_11rem_7rem] gap-4 px-4 pb-3 text-[0.64rem] font-medium uppercase tracking-[0.12em] text-black/42 xl:grid">
          <span>Operator</span>
          <span>Responsibility</span>
          <span>Scope</span>
          <span>Status</span>
          <span className="sr-only">Actions</span>
        </div>
        <div className="space-y-2">
          {filteredOperators.map((entry) => (
            <article
              className="grid gap-4 rounded-[4px] bg-black/[0.035] px-4 py-5 transition-colors hover:bg-black/[0.06] md:grid-cols-2 xl:grid-cols-[minmax(12rem,1.25fr)_10rem_minmax(11rem,0.9fr)_11rem_7rem] xl:items-center"
              key={entry.id}
              role="listitem"
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
                <p className="text-xs text-black/42 xl:hidden">Scope</p>
                <p className="mt-1 text-sm text-black/62 xl:mt-0"><OperatorScope circles={entry.circles} role={entry.role} /></p>
              </div>
              <div>
                <OperatorStatus status={entry.status} />
                <p className="mt-1 text-xs text-black/42">
                  {entry.status === "active" ? `Last active ${formatDate(entry.lastSignedInAt)}` : `Sent ${formatDate(entry.invitedAt)}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-4 xl:justify-end">
                {!entry.authUserId ? (
                  <button
                    className="min-h-11 text-sm font-medium underline decoration-black/25 underline-offset-4 hover:text-[var(--color-poster)]"
                    onClick={() => openAddOperator(entry)}
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

      {addOpen ? (
        <div className="fixed inset-0 z-[160] flex justify-end bg-black/55" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) closeAddOperator();
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
                <p className="font-[var(--font-cadehandy2)] text-2xl leading-none text-[var(--color-poster)] [transform:rotate(-2deg)]">Team access</p>
                <h2 className="mt-2 font-[var(--font-display)] text-4xl leading-none" id="add-operator-title">
                  {resendEmail ? "Send again" : "Add operator"}
                </h2>
              </div>
              <button
                aria-label="Close add operator"
                className="inline-flex size-12 items-center justify-center rounded-full border border-black/20 text-2xl hover:border-black"
                onClick={closeAddOperator}
                type="button"
              >
                ×
              </button>
            </div>

            <form className="mt-8 space-y-7" onSubmit={submitOperator} ref={formRef}>
              <label className={OPERATOR_LABEL_CLASS} htmlFor="operator-display-name">
                <span className={OPERATOR_LABEL_TEXT_CLASS}>Full name</span>
                <input
                  autoComplete="name"
                  className={OPERATOR_FIELD_CLASS}
                  disabled={pending}
                  id="operator-display-name"
                  maxLength={120}
                  name="displayName"
                  ref={firstFieldRef}
                  required
                  type="text"
                />
              </label>

              <label className={OPERATOR_LABEL_CLASS} htmlFor="operator-email">
                <span className={OPERATOR_LABEL_TEXT_CLASS}>Email</span>
                <input
                  aria-describedby={resendEmail ? "operator-email-resend-note" : undefined}
                  autoComplete="email"
                  className={`${OPERATOR_FIELD_CLASS} ${resendEmail ? "cursor-not-allowed bg-black/[0.05]" : ""}`}
                  disabled={pending}
                  id="operator-email"
                  maxLength={254}
                  name="email"
                  readOnly={Boolean(resendEmail)}
                  required
                  type="email"
                />
                {resendEmail ? (
                  <span className="mt-2 block text-xs leading-relaxed text-black/48" id="operator-email-resend-note">
                    The address is locked so the original invitation cannot stay active. Revoke it first to use a different email.
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
                  <legend className={OPERATOR_LABEL_TEXT_CLASS}>Assigned Circles</legend>
                  <p className="mt-2 text-sm text-black/50">Choose every Circle this person should be able to open.</p>
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
                      Create a Circle before adding a Shaper or Guide.
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
                  <span>I understand this grants full access, including the ability to add or remove other operators.</span>
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
                className="ui-heading min-h-12 bg-[var(--color-poster)] px-5 text-xs uppercase tracking-[0.12em] text-white disabled:opacity-50"
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
