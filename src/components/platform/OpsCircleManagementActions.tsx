"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import type { OpsCircleShaperMemberCandidate } from "@/lib/platform/ops-repository";

import {
  OPERATOR_BUTTON_CLASS,
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
} from "@/components/platform/operatorStyles";

type ShaperAssignment = {
  assignedAt: string;
  assignmentId: string;
  authUserId: string;
  name: string;
};

type ResourceAssignment = {
  assignedAt: string;
  assignmentId: string;
  isPinned: boolean;
  resourceId: string;
  title: string;
  version: number;
  versionId: string;
};

type CircleOption = {
  id: string;
  name: string;
  resources: ResourceAssignment[];
  shaper: ShaperAssignment | null;
  status: "active" | "archived" | "completed" | "forming";
};

type Notice = { kind: "error" | "success"; text: string } | null;

async function mutate(path: string, body: Record<string, unknown>, method: "PATCH" | "POST") {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
  const payload = (await response.json().catch(() => null)) as
    | { assignment?: Record<string, unknown>; error?: unknown }
    | null;
  if (!response.ok || !payload?.assignment) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "The action could not be completed.");
  }
  return payload.assignment;
}

function ActionNotice({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      aria-live="polite"
      className={`min-h-5 text-xs leading-relaxed ${notice?.kind === "error" ? "text-[var(--color-poster)]" : "text-black/48"}`}
      role={notice?.kind === "error" ? "alert" : "status"}
    >
      {notice?.text ?? " "}
    </p>
  );
}

const SECONDARY_BUTTON_CLASS =
  "min-h-12 rounded-[4px] border border-black/35 bg-transparent px-5 font-[var(--font-body)] text-sm font-medium text-black/65 hover:border-black hover:text-black disabled:cursor-not-allowed disabled:border-black/15 disabled:text-black/25";

export default function OpsCircleManagementActions({
  initialCircles,
  initialCircleId,
  resources,
  shapers,
  circleMembers = [],
  preview = false,
  section = "all",
}: {
  initialCircles: CircleOption[];
  initialCircleId?: string;
  resources: Array<{ resourceId: string; title: string; version: number; versionId: string }>;
  shapers: Array<{ authUserId: string; name: string }>;
  circleMembers?: OpsCircleShaperMemberCandidate[];
  preview?: boolean;
  section?: "all" | "shaper" | "resources";
}) {
  const router = useRouter();
  const [storedCircles, setCircles] = useState(initialCircles);
  const [circleSource, setCircleSource] = useState(initialCircles);
  const [pending, setPending] = useState<"resource-assign" | "resource-end" | "shaper-assign" | "shaper-end" | null>(null);
  const [resourceNotice, setResourceNotice] = useState<Notice>(null);
  const [shaperNotice, setShaperNotice] = useState<Notice>(null);
  const [editingShaper, setEditingShaper] = useState(false);
  const [addingResource, setAddingResource] = useState(false);

  useEffect(() => { setCircles(initialCircles); setCircleSource(initialCircles); }, [initialCircles]);

  // A server refresh is authoritative immediately, even before effects run.
  const circles = circleSource === initialCircles ? storedCircles : initialCircles;
  const contextKey = initialCircleId ?? "";
  const contextCircle = contextKey ? circles.find((circle) => circle.id === contextKey) : undefined;
  const invalidContext = Boolean(contextKey && (!contextCircle || !["forming", "active"].includes(contextCircle.status)));
  const currentCircles = circles.filter((circle) =>
    (circle.status === "forming" || circle.status === "active") && (!contextKey || circle.id === contextKey),
  );
  const circlesWithoutShaper = currentCircles.filter((circle) => !circle.shaper);
  const currentShaperAssignments = currentCircles.flatMap((circle) =>
    circle.shaper ? [{ circleId: circle.id, circleName: circle.name, ...circle.shaper }] : [],
  );
  const currentResourceAssignments = currentCircles.flatMap((circle) =>
    circle.resources.map((resource) => ({ circleId: circle.id, circleName: circle.name, ...resource })),
  );

  const initialShaperCircle = circlesWithoutShaper.some((circle) => circle.id === contextKey) ? contextKey : "";
  const initialResourceCircle = currentCircles.some((circle) => circle.id === contextKey) ? contextKey : "";
  const [selectionContext, setSelectionContext] = useState(contextKey);
  const [shaperCircleId, setShaperCircleId] = useState(initialShaperCircle);
  const [shaperId, setShaperId] = useState("");
  const [confirmedShaperMember, setConfirmedShaperMember] = useState("");
  const [shaperAssignmentId, setShaperAssignmentId] = useState("");
  const [resourceCircleId, setResourceCircleId] = useState(initialResourceCircle);
  const [resourceId, setResourceId] = useState("");
  const [resourceVersionId, setResourceVersionId] = useState("");
  const [resourceAssignmentId, setResourceAssignmentId] = useState("");
  const [pinned, setPinned] = useState(false);
  const sameContext = selectionContext === contextKey;
  const selectedShaperCircle = sameContext
    ? circlesWithoutShaper.some((circle) => circle.id === shaperCircleId) ? shaperCircleId : ""
    : initialShaperCircle;
  const selectedResourceCircle = sameContext
    ? currentCircles.some((circle) => circle.id === resourceCircleId) ? resourceCircleId : ""
    : initialResourceCircle;
  const currentCircleMembers = circleMembers.filter((member) => member.circleId === selectedShaperCircle);
  const otherShapers = shapers.filter((shaper) => !currentCircleMembers.some((member) => member.authUserId === shaper.authUserId));
  const selectedMember = !invalidContext && sameContext ? currentCircleMembers.find((member) => `member:${member.memberId}` === shaperId && member.authUserId && !member.unavailableReason) : undefined;
  const selectedShaper = !invalidContext && sameContext && (selectedMember || otherShapers.some((shaper) => shaper.authUserId === shaperId)) ? shaperId : "";
  const selectedMemberKey = selectedMember ? `${selectedShaperCircle}:${selectedMember.memberId}:${selectedMember.authUserId}` : "";
  const memberAccessConfirmed = !selectedMember?.requiresShaperAccess || confirmedShaperMember === selectedMemberKey;
  const selectedShaperAssignment = !invalidContext && sameContext && currentShaperAssignments.some((assignment) => assignment.assignmentId === shaperAssignmentId) ? shaperAssignmentId : "";
  const selectedResource = !invalidContext && sameContext && resources.some((resource) => resource.resourceId === resourceId && resource.versionId === resourceVersionId) ? resourceId : "";
  const selectedResourceAssignment = !invalidContext && sameContext && currentResourceAssignments.some((assignment) => assignment.assignmentId === resourceAssignmentId) ? resourceAssignmentId : "";
  const selectedPinned = !invalidContext && sameContext && pinned;

  // Never let the browser fall through to the next option after a refresh, or
  // resurrect a removed choice if it later becomes available again.
  useEffect(() => {
    setSelectionContext(contextKey);
    setShaperCircleId(selectedShaperCircle);
    setShaperId(selectedShaper);
    if (!selectedShaper) setConfirmedShaperMember("");
    setShaperAssignmentId(selectedShaperAssignment);
    setResourceCircleId(selectedResourceCircle);
    setResourceId(selectedResource);
    if (!selectedResource) setResourceVersionId("");
    setResourceAssignmentId(selectedResourceAssignment);
    setPinned(selectedPinned);
  }, [contextKey, selectedShaperCircle, selectedShaper, selectedShaperAssignment, selectedResourceCircle, selectedResource, selectedResourceAssignment, selectedPinned]);

  useEffect(() => {
    setEditingShaper(false);
    setAddingResource(false);
    setShaperNotice(null);
    setResourceNotice(null);
  }, [contextKey]);

  async function assignShaper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview) { setShaperNotice({ kind: "success", text: "Preview only. The Shaper was not changed." }); return; }
    if (pending !== null) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const circleId = String(data.get("circleId") ?? "");
    const submittedChoice = String(data.get("shaperAuthUserId") ?? "");
    if (invalidContext || !selectedShaperCircle || circleId !== selectedShaperCircle || !selectedShaper || submittedChoice !== selectedShaper) {
      setShaperNotice({ kind: "error", text: "Choose a current Circle member or active Shaper again. Nothing was changed." }); return;
    }
    if (selectedMember?.requiresShaperAccess && (!memberAccessConfirmed || data.get("grantShaperAccess") !== "on")) {
      setShaperNotice({ kind: "error", text: "Confirm Shaper access for this Circle before saving. Nothing was changed." }); return;
    }
    const shaperAuthUserId = selectedMember?.authUserId ?? selectedShaper;
    setPending("shaper-assign");
    setShaperNotice(null);
    try {
      const assignment = await mutate(
        "/api/ops/circle-shaper-assignments",
        selectedMember ? { circleId, memberId: selectedMember.memberId, grantShaperAccess: selectedMember.requiresShaperAccess && memberAccessConfirmed } : { circleId, shaperAuthUserId },
        "POST",
      );
      if (selectedMember && (assignment.authUserId !== shaperAuthUserId || assignment.circleId !== circleId || assignment.memberId !== selectedMember.memberId || !assignment.assignmentId || !assignment.assignedAt)) {
        throw new Error("The saved assignment could not be confirmed. Refresh this Circle before trying again.");
      }
      const shaper = selectedMember ?? shapers.find((candidate) => candidate.authUserId === shaperAuthUserId);
      setCircles((current) => current.map((circle) =>
        circle.id === circleId
          ? {
              ...circle,
              shaper: {
                assignedAt: String(assignment.assignedAt ?? new Date().toISOString()),
                assignmentId: String(assignment.assignmentId ?? ""),
                authUserId: shaperAuthUserId,
                name: shaper?.name ?? "Shaper",
              },
            }
          : circle,
      ));
      form.reset();
      setShaperId("");
      setConfirmedShaperMember("");
      setShaperCircleId("");
      setEditingShaper(false);
      setShaperNotice({ kind: "success", text: `${shaper?.name ?? "Shaper"} is assigned to ${currentCircles.find((circle) => circle.id === circleId)?.name ?? "the selected Circle"}.` });
      router.refresh();
    } catch (error) {
      setShaperNotice({ kind: "error", text: error instanceof Error ? error.message : "The Shaper could not be assigned." });
    } finally {
      setPending(null);
    }
  }

  async function endShaper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview) { setShaperNotice({ kind: "success", text: "Preview only. The Shaper was not changed." }); return; }
    if (pending !== null) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const assignmentId = String(data.get("assignmentId") ?? "");
    if (invalidContext || !selectedShaperAssignment || assignmentId !== selectedShaperAssignment) {
      setShaperNotice({ kind: "error", text: "Choose a current Shaper assignment again. Nothing was changed." }); return;
    }
    setPending("shaper-end");
    setShaperNotice(null);
    try {
      await mutate("/api/ops/circle-shaper-assignments", { assignmentId }, "PATCH");
      setCircles((current) => current.map((circle) =>
        circle.shaper?.assignmentId === assignmentId ? { ...circle, shaper: null } : circle,
      ));
      form.reset();
      setShaperAssignmentId("");
      setShaperCircleId(contextKey);
      setShaperNotice({ kind: "success", text: `The Shaper assignment for ${currentShaperAssignments.find((assignment) => assignment.assignmentId === assignmentId)?.circleName ?? "the selected Circle"} ended. Its history remains recorded.` });
      router.refresh();
    } catch (error) {
      setShaperNotice({ kind: "error", text: error instanceof Error ? error.message : "The Shaper assignment could not be ended." });
    } finally {
      setPending(null);
    }
  }

  async function assignResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview) { setResourceNotice({ kind: "success", text: "Preview only. Circle resources were not changed." }); return; }
    if (pending !== null) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const circleId = String(data.get("circleId") ?? "");
    const resourceId = String(data.get("resourceId") ?? "");
    const isPinned = data.get("isPinned") === "on";
    if (invalidContext || !selectedResourceCircle || circleId !== selectedResourceCircle || !selectedResource || resourceId !== selectedResource) {
      setResourceNotice({ kind: "error", text: "Choose a current Circle and published resource again. Nothing was changed." }); return;
    }
    setPending("resource-assign");
    setResourceNotice(null);
    try {
      const assignment = await mutate(
        "/api/ops/circle-resources",
        { circleId, isPinned, resourceId },
        "POST",
      );
      const resource = resources.find((candidate) => candidate.resourceId === resourceId);
      if (assignment.created !== false) {
        setCircles((current) => current.map((circle) =>
          circle.id === circleId
            ? {
                ...circle,
                resources: [
                  ...circle.resources,
                  {
                    assignedAt: String(assignment.assignedAt ?? new Date().toISOString()),
                    assignmentId: String(assignment.assignmentId ?? ""),
                    isPinned,
                    resourceId,
                    title: String(assignment.title ?? resource?.title ?? "Circle resource"),
                    version: Number(assignment.version ?? resource?.version ?? 1),
                    versionId: String(assignment.versionId ?? resource?.versionId ?? ""),
                  },
                ],
              }
            : circle,
        ));
      }
      form.reset();
      setResourceId("");
      setResourceVersionId("");
      setPinned(false);
      setAddingResource(false);
      setResourceNotice({
        kind: "success",
        text: assignment.created === false
          ? "That exact resource is already active for the Circle."
          : `${resource?.title ?? "Resource"} was assigned to ${currentCircles.find((circle) => circle.id === circleId)?.name ?? "the selected Circle"} as an exact version.`,
      });
      router.refresh();
    } catch (error) {
      setResourceNotice({ kind: "error", text: error instanceof Error ? error.message : "The resource could not be assigned." });
    } finally {
      setPending(null);
    }
  }

  async function endResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview) { setResourceNotice({ kind: "success", text: "Preview only. Circle resources were not changed." }); return; }
    if (pending !== null) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const assignmentId = String(data.get("assignmentId") ?? "");
    if (invalidContext || !selectedResourceAssignment || assignmentId !== selectedResourceAssignment) {
      setResourceNotice({ kind: "error", text: "Choose a current resource assignment again. Nothing was changed." }); return;
    }
    setPending("resource-end");
    setResourceNotice(null);
    try {
      await mutate("/api/ops/circle-resources", { assignmentId }, "PATCH");
      setCircles((current) => current.map((circle) => ({
        ...circle,
        resources: circle.resources.filter((resource) => resource.assignmentId !== assignmentId),
      })));
      form.reset();
      setResourceAssignmentId("");
      setResourceNotice({ kind: "success", text: `The resource is no longer active for ${currentResourceAssignments.find((assignment) => assignment.assignmentId === assignmentId)?.circleName ?? "the selected Circle"}. Its version history remains recorded.` });
      router.refresh();
    } catch (error) {
      setResourceNotice({ kind: "error", text: error instanceof Error ? error.message : "The resource assignment could not be ended." });
    } finally {
      setPending(null);
    }
  }

  const shaperPicker = <>
    <label className={OPERATOR_LABEL_CLASS}>
      <span className={OPERATOR_LABEL_TEXT_CLASS}>Choose Shaper</span>
      <select className={OPERATOR_FIELD_CLASS} value={selectedShaper} onChange={(event) => { setShaperId(event.target.value); setConfirmedShaperMember(""); setShaperNotice(null); }} disabled={pending !== null || (!currentCircleMembers.length && !otherShapers.length)} name="shaperAuthUserId" required>
        <option disabled value="">Choose a person</option>
        {currentCircleMembers.length ? <optgroup label="Circle members">
          {currentCircleMembers.map((member) => <option key={member.memberId} value={`member:${member.memberId}`} disabled={Boolean(member.unavailableReason) || !member.authUserId}>{member.name} · {member.email}{member.unavailableReason ? " — unavailable" : ""}</option>)}
        </optgroup> : null}
        {otherShapers.length ? <optgroup label="Existing Shapers">
          {otherShapers.map((shaper) => <option key={shaper.authUserId} value={shaper.authUserId}>{shaper.name}</option>)}
        </optgroup> : null}
      </select>
    </label>
    {currentCircleMembers.some((member) => member.unavailableReason) ? <details className="text-sm text-black/65">
      <summary className="w-fit cursor-pointer py-2 underline underline-offset-4">Why are some members unavailable?</summary>
      <ul className="mt-1 space-y-2">{currentCircleMembers.filter((member) => member.unavailableReason).map((member) => <li key={member.memberId}><Link className="font-semibold underline underline-offset-4" href={`/ops/members/${encodeURIComponent(member.memberId)}`}>{member.name}</Link>: {member.unavailableReason}</li>)}</ul>
    </details> : null}
  </>;
  const shaperAccessConfirmation = selectedMember?.requiresShaperAccess ? <label className="flex items-start gap-3 text-sm leading-relaxed text-black/75">
    <input className="mt-0.5 size-5 shrink-0 accent-[var(--color-poster)]" type="checkbox" name="grantShaperAccess" checked={memberAccessConfirmed} onChange={(event) => setConfirmedShaperMember(event.target.checked ? selectedMemberKey : "")} required disabled={pending !== null} />
    <span>Give {selectedMember.name} Shaper access to manage this Circle. This does not grant administrator access.</span>
  </label> : null;

  if (invalidContext) return (
    <section aria-label="Shaper and Circle resource administration" className="pt-4">
      <p className="text-sm leading-relaxed text-black/65">This Circle is no longer available for Shaper or resource changes. Nothing has been selected in another Circle.</p>
      <Link className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/ops/circles">View all Circles</Link>
    </section>
  );

  // In a Circle's manager the Circle is already chosen. Show its saved state
  // once, and reveal only the action the operator has asked to perform.
  if (contextCircle && section !== "all") return (
    <section
      aria-label={section === "shaper" ? "Circle Shaper" : "Circle resources"}
      data-operator-pending={pending !== null ? "true" : undefined}
      data-operator-dirty={selectedShaper || selectedResource || selectedPinned || selectedShaperAssignment || selectedResourceAssignment ? "true" : undefined}
      className="space-y-4"
    >
      {section === "shaper" ? <>
        <header className="flex items-start justify-between gap-4">
          <div>
            <h3 className={OPERATOR_LABEL_TEXT_CLASS}>Shaper</h3>
            <p className="mt-1 text-lg font-semibold">{contextCircle.shaper?.name ?? "Not assigned"}</p>
          </div>
          {!editingShaper ? <button
            className="min-h-11 px-2 text-sm underline underline-offset-4"
            disabled={pending !== null}
            onClick={() => {
              setEditingShaper(true);
              setShaperCircleId(contextCircle.shaper ? "" : contextCircle.id);
              setShaperNotice(null);
            }}
            type="button"
          >{contextCircle.shaper ? "Edit Shaper" : "Assign Shaper"}</button> : null}
        </header>
        {editingShaper ? <div className="space-y-3 rounded-lg bg-black/[0.035] p-4">
          {contextCircle.shaper ? selectedShaperAssignment ? <form className="space-y-3" onSubmit={endShaper}>
            <input name="assignmentId" type="hidden" value={selectedShaperAssignment} />
            <p className="text-sm text-black/65">Remove {contextCircle.shaper.name} as Shaper? This Circle will have no Shaper until another is assigned. Assignment history is kept.</p>
            <div className="flex flex-wrap gap-3">
              <button className={SECONDARY_BUTTON_CLASS} disabled={pending !== null} type="submit">{pending === "shaper-end" ? "Removing…" : "Confirm removal"}</button>
              <button className="min-h-11 px-2 text-sm underline underline-offset-4" disabled={pending !== null} onClick={() => setShaperAssignmentId("")} type="button">Cancel</button>
            </div>
          </form> : <>
            <p className="text-sm text-black/65">To change the Shaper, remove the current assignment first, then choose someone new.</p>
            <button className={SECONDARY_BUTTON_CLASS} disabled={pending !== null} onClick={() => setShaperAssignmentId(contextCircle.shaper?.assignmentId ?? "")} type="button">Remove Shaper</button>
          </> : <form className="grid gap-3" onSubmit={assignShaper}>
            <input name="circleId" type="hidden" value={selectedShaperCircle} />
            {shaperPicker}
            {shaperAccessConfirmation}
            {!currentCircleMembers.length && !otherShapers.length ? <p className="text-sm text-black/60">Add a member to this Circle, then choose them here. To bring in someone else, <Link className="underline underline-offset-4" href="/ops/operators?add=1">invite a Shaper</Link> and choose this Circle in the invitation.</p> : null}
            <button className={`${OPERATOR_BUTTON_CLASS} w-fit`} disabled={pending !== null || !selectedShaperCircle || !selectedShaper || !memberAccessConfirmed} type="submit">{pending === "shaper-assign" ? "Assigning…" : "Save Shaper"}</button>
          </form>}
          {!selectedShaperAssignment ? <button className="min-h-11 px-2 text-sm underline underline-offset-4" disabled={pending !== null} onClick={() => { setEditingShaper(false); setShaperId(""); }} type="button">Cancel</button> : null}
        </div> : null}
        <ActionNotice notice={shaperNotice} />
      </> : <>
        <header className="flex items-center justify-between gap-4">
          <h3 className="ui-heading text-xl font-semibold">Resources</h3>
          {!addingResource ? <button className="min-h-11 px-2 text-sm underline underline-offset-4" disabled={pending !== null} onClick={() => { setAddingResource(true); setResourceCircleId(contextCircle.id); setResourceNotice(null); }} type="button">Add resource</button> : null}
        </header>
        {contextCircle.resources.length ? <ul className="space-y-2">
          {contextCircle.resources.map((resource) => <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-black/[0.035] px-4 py-2" key={resource.assignmentId}>
            <div><p className="text-sm font-semibold">{resource.title}</p><p className="mt-1 text-xs text-black/55">v{resource.version}{resource.isPinned ? " · Pinned" : ""}</p></div>
            <button aria-label={`Remove ${resource.title}`} className="min-h-11 px-2 text-sm underline underline-offset-4" disabled={pending !== null || Boolean(selectedResourceAssignment)} onClick={() => { setResourceAssignmentId(resource.assignmentId); setResourceNotice(null); }} type="button">Remove</button>
          </li>)}
        </ul> : <p className="text-sm text-black/55">No resources shared yet.</p>}
        {selectedResourceAssignment ? <form className="space-y-3 rounded-lg bg-black/[0.035] p-4" onSubmit={endResource}>
          <input name="assignmentId" type="hidden" value={selectedResourceAssignment} />
          <p className="text-sm text-black/65">Remove {currentResourceAssignments.find((resource) => resource.assignmentId === selectedResourceAssignment)?.title} from this Circle? Members will no longer see it here. Its version history is kept.</p>
          <div className="flex flex-wrap gap-3"><button className={SECONDARY_BUTTON_CLASS} disabled={pending !== null} type="submit">{pending === "resource-end" ? "Removing…" : "Confirm removal"}</button><button className="min-h-11 px-2 text-sm underline underline-offset-4" disabled={pending !== null} onClick={() => setResourceAssignmentId("")} type="button">Cancel</button></div>
        </form> : null}
        {addingResource ? <form className="grid gap-3 rounded-lg bg-black/[0.035] p-4" onSubmit={assignResource}>
          <input name="circleId" type="hidden" value={selectedResourceCircle} />
          <label className={OPERATOR_LABEL_CLASS}>
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Published resource</span>
            <select className={OPERATOR_FIELD_CLASS} value={selectedResource} onChange={(event) => { setResourceId(event.target.value); setResourceVersionId(resources.find((resource) => resource.resourceId === event.target.value)?.versionId ?? ""); }} disabled={pending !== null || !resources.length} name="resourceId" required>
              <option disabled value="">Choose resource</option>
              {resources.map((resource) => <option key={resource.resourceId} value={resource.resourceId}>{resource.title} · v{resource.version}</option>)}
            </select>
          </label>
          {!resources.length ? <p className="text-sm text-black/60">No published resources yet. <Link className="underline underline-offset-4" href="/ops/academy">Open Academy</Link> to publish one.</p> : null}
          <label className="flex items-center gap-3 text-sm text-black/65"><input className="size-4 accent-[var(--color-poster)]" checked={selectedPinned} onChange={(event) => setPinned(event.target.checked)} name="isPinned" type="checkbox" />Pin this resource first</label>
          <div className="flex flex-wrap gap-3"><button className={OPERATOR_BUTTON_CLASS} disabled={pending !== null || !selectedResourceCircle || !selectedResource} type="submit">{pending === "resource-assign" ? "Adding…" : "Share resource"}</button><button className="min-h-11 px-2 text-sm underline underline-offset-4" disabled={pending !== null} onClick={() => { setAddingResource(false); setResourceId(""); setResourceVersionId(""); setPinned(false); }} type="button">Cancel</button></div>
        </form> : null}
        <ActionNotice notice={resourceNotice} />
      </>}
    </section>
  );

  return (
    <section aria-label="Shaper and Circle resource administration" className="grid gap-12 pt-4 lg:grid-cols-2">
      {contextCircle ? <header className="flex flex-wrap items-center justify-between gap-3 lg:col-span-2">
        <p className="text-sm text-black/65">Managing <strong>{contextCircle.name}</strong> only</p>
        <Link className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href="/ops/circles">View all Circles</Link>
      </header> : null}
      <div>
        <div>
          <h2 className="ui-heading mt-1 text-2xl font-black uppercase tracking-[-0.035em]">Shaper</h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-black/52">
            The Shaper leads the Circle. Choose a Circle member or an existing Shaper.
          </p>
        </div>
        <form className="mt-6 grid gap-3" onSubmit={assignShaper}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Circle</span>
              <select className={OPERATOR_FIELD_CLASS} value={selectedShaperCircle} onChange={(event) => setShaperCircleId(event.target.value)} disabled={pending !== null || circlesWithoutShaper.length === 0} name="circleId" required>
                <option disabled value="">Choose Circle</option>
                {circlesWithoutShaper.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}
              </select>
            </label>
            <div className="space-y-2">{shaperPicker}</div>
          </div>
          {shaperAccessConfirmation}
          <button className={`${OPERATOR_BUTTON_CLASS} w-fit`} disabled={pending !== null || !selectedShaperCircle || !selectedShaper || !memberAccessConfirmed} type="submit">
            {pending === "shaper-assign" ? "Assigning" : "Assign Shaper"}
          </button>
        </form>
        {!currentCircleMembers.length && !otherShapers.length ? <p className="mt-3 text-sm text-black/60">Open a Circle to choose one of its members, or <Link className="underline underline-offset-4" href="/ops/operators?add=1">invite someone as a Shaper</Link> and choose their Circle in the invitation. Their assignment is created when they accept; there is no need to assign them again here.</p> : null}
        {currentShaperAssignments.length ? <form className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={endShaper}>
          <label className={OPERATOR_LABEL_CLASS}>
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Current assignment</span>
            <select className={OPERATOR_FIELD_CLASS} value={selectedShaperAssignment} onChange={(event) => setShaperAssignmentId(event.target.value)} disabled={pending !== null || currentShaperAssignments.length === 0} name="assignmentId" required>
              <option disabled value="">Choose assignment</option>
              {currentShaperAssignments.map((assignment) => (
                <option key={assignment.assignmentId} value={assignment.assignmentId}>{assignment.circleName} · {assignment.name}</option>
              ))}
            </select>
          </label>
          <button className={SECONDARY_BUTTON_CLASS} disabled={pending !== null || !selectedShaperAssignment} type="submit">
            {pending === "shaper-end" ? "Removing" : "Remove Shaper"}
          </button>
        </form> : <p className="mt-4 text-sm text-black/60">No Shaper assigned yet.</p>}
        <ActionNotice notice={shaperNotice} />
      </div>

      <div>
        <div>
          <h2 className="ui-heading mt-1 text-2xl font-black uppercase tracking-[-0.035em]">Circle resources</h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-black/52">
            Share a published lesson or document. Members receive the version shown here.
          </p>
        </div>
        <form className="mt-6 grid gap-3" onSubmit={assignResource}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Circle</span>
              <select className={OPERATOR_FIELD_CLASS} value={selectedResourceCircle} onChange={(event) => setResourceCircleId(event.target.value)} disabled={pending !== null || currentCircles.length === 0} name="circleId" required>
                <option disabled value="">Choose Circle</option>
                {currentCircles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}
              </select>
            </label>
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Published resource</span>
              <select className={OPERATOR_FIELD_CLASS} value={selectedResource} onChange={(event) => { setResourceId(event.target.value); setResourceVersionId(resources.find((resource) => resource.resourceId === event.target.value)?.versionId ?? ""); }} disabled={pending !== null || resources.length === 0} name="resourceId" required>
                <option disabled value="">Choose resource</option>
                {resources.map((resource) => <option key={resource.resourceId} value={resource.resourceId}>{resource.title} · v{resource.version}</option>)}
              </select>
            </label>
          </div>
          <label className="flex w-fit items-center gap-3 text-sm text-black/62">
            <input className="size-4 accent-[var(--color-poster)]" checked={selectedPinned} onChange={(event) => setPinned(event.target.checked)} name="isPinned" type="checkbox" />
            Pin this resource first
          </label>
          <button className={`${OPERATOR_BUTTON_CLASS} w-fit`} disabled={pending !== null || !selectedResourceCircle || !selectedResource} type="submit">
            {pending === "resource-assign" ? "Adding" : "Add resource"}
          </button>
        </form>
        {resources.length === 0 ? <p className="mt-3 text-sm text-black/60">No published resources yet. <Link className="underline underline-offset-4" href="/ops/academy">Open Academy</Link> to prepare and publish one.</p> : null}
        {currentResourceAssignments.length ? <form className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={endResource}>
          <label className={OPERATOR_LABEL_CLASS}>
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Active Circle resource</span>
            <select className={OPERATOR_FIELD_CLASS} value={selectedResourceAssignment} onChange={(event) => setResourceAssignmentId(event.target.value)} disabled={pending !== null || currentResourceAssignments.length === 0} name="assignmentId" required>
              <option disabled value="">Choose resource</option>
              {currentResourceAssignments.map((assignment) => (
                <option key={assignment.assignmentId} value={assignment.assignmentId}>
                  {assignment.circleName} · {assignment.title} · v{assignment.version}
                </option>
              ))}
            </select>
          </label>
          <button className={SECONDARY_BUTTON_CLASS} disabled={pending !== null || !selectedResourceAssignment} type="submit">
            {pending === "resource-end" ? "Removing" : "Remove resource"}
          </button>
        </form> : <p className="mt-4 text-sm text-black/60">No resources shared yet.</p>}
        <ActionNotice notice={resourceNotice} />
      </div>
    </section>
  );
}
