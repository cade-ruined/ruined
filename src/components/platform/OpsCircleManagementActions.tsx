"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

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
  "min-h-12 rounded-[4px] border border-black/35 bg-transparent px-5 font-[var(--font-body)] text-[0.62rem] font-medium uppercase tracking-[0.15em] text-black/65 hover:border-black hover:text-black disabled:cursor-not-allowed disabled:border-black/15 disabled:text-black/25";

export default function OpsCircleManagementActions({
  initialCircles,
  resources,
  shapers,
}: {
  initialCircles: CircleOption[];
  resources: Array<{ resourceId: string; title: string; version: number; versionId: string }>;
  shapers: Array<{ authUserId: string; name: string }>;
}) {
  const router = useRouter();
  const [circles, setCircles] = useState(initialCircles);
  const [pending, setPending] = useState<"resource-assign" | "resource-end" | "shaper-assign" | "shaper-end" | null>(null);
  const [resourceNotice, setResourceNotice] = useState<Notice>(null);
  const [shaperNotice, setShaperNotice] = useState<Notice>(null);

  useEffect(() => setCircles(initialCircles), [initialCircles]);

  const currentCircles = circles.filter((circle) => circle.status === "forming" || circle.status === "active");
  const circlesWithoutShaper = currentCircles.filter((circle) => !circle.shaper);
  const currentShaperAssignments = circles.flatMap((circle) =>
    circle.shaper ? [{ circleId: circle.id, circleName: circle.name, ...circle.shaper }] : [],
  );
  const currentResourceAssignments = circles.flatMap((circle) =>
    circle.resources.map((resource) => ({ circleId: circle.id, circleName: circle.name, ...resource })),
  );

  async function assignShaper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("shaper-assign");
    setShaperNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const circleId = String(data.get("circleId") ?? "");
    const shaperAuthUserId = String(data.get("shaperAuthUserId") ?? "");
    try {
      const assignment = await mutate(
        "/api/ops/circle-shaper-assignments",
        { circleId, shaperAuthUserId },
        "POST",
      );
      const shaper = shapers.find((candidate) => candidate.authUserId === shaperAuthUserId);
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
      setShaperNotice({ kind: "success", text: `${shaper?.name ?? "Shaper"} is assigned to the Circle.` });
      router.refresh();
    } catch (error) {
      setShaperNotice({ kind: "error", text: error instanceof Error ? error.message : "The Shaper could not be assigned." });
    } finally {
      setPending(null);
    }
  }

  async function endShaper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("shaper-end");
    setShaperNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const assignmentId = String(data.get("assignmentId") ?? "");
    try {
      await mutate("/api/ops/circle-shaper-assignments", { assignmentId }, "PATCH");
      setCircles((current) => current.map((circle) =>
        circle.shaper?.assignmentId === assignmentId ? { ...circle, shaper: null } : circle,
      ));
      form.reset();
      setShaperNotice({ kind: "success", text: "The Shaper assignment ended. Its history remains recorded." });
      router.refresh();
    } catch (error) {
      setShaperNotice({ kind: "error", text: error instanceof Error ? error.message : "The Shaper assignment could not be ended." });
    } finally {
      setPending(null);
    }
  }

  async function assignResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("resource-assign");
    setResourceNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const circleId = String(data.get("circleId") ?? "");
    const resourceId = String(data.get("resourceId") ?? "");
    const isPinned = data.get("isPinned") === "on";
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
                    title: resource?.title ?? "Circle resource",
                    version: Number(resource?.version ?? 1),
                    versionId: String(resource?.versionId ?? ""),
                  },
                ],
              }
            : circle,
        ));
      }
      form.reset();
      setResourceNotice({
        kind: "success",
        text: assignment.created === false
          ? "That exact resource is already active for the Circle."
          : `${resource?.title ?? "Resource"} was assigned as an exact version.`,
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
    setPending("resource-end");
    setResourceNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const assignmentId = String(data.get("assignmentId") ?? "");
    try {
      await mutate("/api/ops/circle-resources", { assignmentId }, "PATCH");
      setCircles((current) => current.map((circle) => ({
        ...circle,
        resources: circle.resources.filter((resource) => resource.assignmentId !== assignmentId),
      })));
      form.reset();
      setResourceNotice({ kind: "success", text: "The resource is no longer active for the Circle. Its version history remains recorded." });
      router.refresh();
    } catch (error) {
      setResourceNotice({ kind: "error", text: error instanceof Error ? error.message : "The resource assignment could not be ended." });
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-label="Shaper and Circle resource administration" className="grid gap-12 pt-4 lg:grid-cols-2">
      <div>
        <div>
          <p className="[font-family:var(--font-cadehandy2)] text-xl text-[var(--color-poster)]">Circle role</p>
          <h2 className="ui-heading mt-1 text-2xl font-black uppercase tracking-[-0.035em]">Shaper</h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-black/52">
            One active Shaper can hold a Circle. Ending an assignment never erases its history.
          </p>
        </div>
        <form className="mt-6 grid gap-3" onSubmit={assignShaper}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Circle without a Shaper</span>
              <select className={OPERATOR_FIELD_CLASS} defaultValue="" disabled={pending !== null || circlesWithoutShaper.length === 0} name="circleId" required>
                <option disabled value="">Choose Circle</option>
                {circlesWithoutShaper.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}
              </select>
            </label>
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Active Shaper</span>
              <select className={OPERATOR_FIELD_CLASS} defaultValue="" disabled={pending !== null || shapers.length === 0} name="shaperAuthUserId" required>
                <option disabled value="">Choose Shaper</option>
                {shapers.map((shaper) => <option key={shaper.authUserId} value={shaper.authUserId}>{shaper.name}</option>)}
              </select>
            </label>
          </div>
          <button className={`${OPERATOR_BUTTON_CLASS} w-fit`} disabled={pending !== null || circlesWithoutShaper.length === 0 || shapers.length === 0} type="submit">
            {pending === "shaper-assign" ? "Assigning" : "Assign Shaper"}
          </button>
        </form>
        <form className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={endShaper}>
          <label className={OPERATOR_LABEL_CLASS}>
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Current assignment</span>
            <select className={OPERATOR_FIELD_CLASS} defaultValue="" disabled={pending !== null || currentShaperAssignments.length === 0} name="assignmentId" required>
              <option disabled value="">Choose assignment</option>
              {currentShaperAssignments.map((assignment) => (
                <option key={assignment.assignmentId} value={assignment.assignmentId}>{assignment.circleName} · {assignment.name}</option>
              ))}
            </select>
          </label>
          <button className={SECONDARY_BUTTON_CLASS} disabled={pending !== null || currentShaperAssignments.length === 0} type="submit">
            {pending === "shaper-end" ? "Ending" : "End assignment"}
          </button>
        </form>
        <ActionNotice notice={shaperNotice} />
      </div>

      <div>
        <div>
          <p className="[font-family:var(--font-cadehandy2)] text-xl text-[var(--color-poster)]">For the room</p>
          <h2 className="ui-heading mt-1 text-2xl font-black uppercase tracking-[-0.035em]">Circle resources</h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-black/52">
            A Circle receives the exact published version selected now. Newer versions require a deliberate reassignment.
          </p>
        </div>
        <form className="mt-6 grid gap-3" onSubmit={assignResource}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Circle</span>
              <select className={OPERATOR_FIELD_CLASS} defaultValue="" disabled={pending !== null || currentCircles.length === 0} name="circleId" required>
                <option disabled value="">Choose Circle</option>
                {currentCircles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}
              </select>
            </label>
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Published resource</span>
              <select className={OPERATOR_FIELD_CLASS} defaultValue="" disabled={pending !== null || resources.length === 0} name="resourceId" required>
                <option disabled value="">Choose resource</option>
                {resources.map((resource) => <option key={resource.resourceId} value={resource.resourceId}>{resource.title} · v{resource.version}</option>)}
              </select>
            </label>
          </div>
          <label className="flex w-fit items-center gap-3 text-sm text-black/62">
            <input className="size-4 accent-[var(--color-poster)]" name="isPinned" type="checkbox" />
            Pin this resource first
          </label>
          <button className={`${OPERATOR_BUTTON_CLASS} w-fit`} disabled={pending !== null || currentCircles.length === 0 || resources.length === 0} type="submit">
            {pending === "resource-assign" ? "Assigning" : "Assign exact version"}
          </button>
        </form>
        <form className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={endResource}>
          <label className={OPERATOR_LABEL_CLASS}>
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Active Circle resource</span>
            <select className={OPERATOR_FIELD_CLASS} defaultValue="" disabled={pending !== null || currentResourceAssignments.length === 0} name="assignmentId" required>
              <option disabled value="">Choose resource</option>
              {currentResourceAssignments.map((assignment) => (
                <option key={assignment.assignmentId} value={assignment.assignmentId}>
                  {assignment.circleName} · {assignment.title} · v{assignment.version}
                </option>
              ))}
            </select>
          </label>
          <button className={SECONDARY_BUTTON_CLASS} disabled={pending !== null || currentResourceAssignments.length === 0} type="submit">
            {pending === "resource-end" ? "Ending" : "End assignment"}
          </button>
        </form>
        <ActionNotice notice={resourceNotice} />
      </div>
    </section>
  );
}
