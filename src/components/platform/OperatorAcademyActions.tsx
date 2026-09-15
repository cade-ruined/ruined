"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import {
  OPERATOR_BUTTON_CLASS,
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
} from "@/components/platform/operatorStyles";
import type {
  OpsAcademyAudience,
  OpsAcademyCollection,
  OpsAcademyReferenceOptions,
  OpsAcademyResourceDraft,
  OpsAcademyStatus,
} from "@/lib/platform/ops-academy-model";

async function academyRequest<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
  const result = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!response.ok) {
    throw new Error(typeof result?.error === "string" ? result.error : "The Academy action could not be completed.");
  }
  if (!result) throw new Error("The Academy action returned no result.");
  return result;
}

function audiencesFromForm(data: FormData) {
  if (data.get("audienceAll") === "yes") return [{ kind: "all_members" as const, id: null }];
  return [
    ...data.getAll("circleIds").map((id) => ({ id: String(id), kind: "circle" as const })),
    ...data.getAll("blockIds").map((id) => ({ id: String(id), kind: "block" as const })),
  ];
}

function resourcePayload(data: FormData, resource?: OpsAcademyResourceDraft) {
  return {
    audiences: audiencesFromForm(data),
    bodyText: String(data.get("bodyText") ?? ""),
    captionsUrl: String(data.get("captionsUrl") ?? ""),
    collectionId: String(data.get("collectionId") ?? ""),
    contentType: String(data.get("contentType") ?? "article"),
    durationLabel: String(data.get("durationLabel") ?? ""),
    expectedRevision: resource?.revision,
    externalUrl: String(data.get("externalUrl") ?? ""),
    featured: data.get("featured") === "yes",
    position: Number(data.get("position") ?? 1),
    presenter: String(data.get("presenter") ?? ""),
    slug: String(data.get("slug") ?? ""),
    summary: String(data.get("summary") ?? ""),
    thumbnailUrl: String(data.get("thumbnailUrl") ?? ""),
    title: String(data.get("title") ?? ""),
    videoUrl: String(data.get("videoUrl") ?? ""),
  };
}

function AudienceFields({
  audiences = [],
  options,
}: {
  audiences?: OpsAcademyAudience[];
  options: OpsAcademyReferenceOptions;
}) {
  const [allMembers, setAllMembers] = useState(() => audiences.some((audience) => audience.kind === "all_members"));
  const [circleIds, setCircleIds] = useState(() => new Set(audiences.flatMap((audience) => audience.kind === "circle" && audience.id ? [audience.id] : [])));
  const [blockIds, setBlockIds] = useState(() => new Set(audiences.flatMap((audience) => audience.kind === "block" && audience.id ? [audience.id] : [])));
  const groups = [
    { label: "Circles", name: "circleIds", options: options.circles, selected: circleIds, setSelected: setCircleIds },
    { label: "Blocks", name: "blockIds", options: options.blocks, selected: blockIds, setSelected: setBlockIds },
  ];
  return (
    <fieldset className="grid gap-2 rounded-[6px] bg-black/[0.035] p-3 sm:grid-cols-2">
      <legend className="operator-compact-label px-1">Audience</legend>
      <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
        <input checked={allMembers} className="size-4 shrink-0 accent-[var(--color-faded)]" name="audienceAll" onChange={(event) => setAllMembers(event.target.checked)} type="checkbox" value="yes" />
        All active members
      </label>
      {groups.map((group) => <fieldset className="min-w-0" hidden={allMembers} key={group.name}>
        <legend className={OPERATOR_LABEL_TEXT_CLASS}>{group.label}</legend>
        <div className="mt-2 max-h-40 overflow-y-auto rounded-[4px] bg-[var(--color-bone)]/60 p-1">
          {group.options.length ? group.options.map((option) => <label className="flex min-h-11 items-center gap-3 rounded-[3px] px-2 text-sm" key={option.id}>
            <input checked={group.selected.has(option.id)} className="size-4 shrink-0 accent-[var(--color-faded)]" disabled={allMembers} name={group.name} onChange={(event) => {
              const checked = event.target.checked;
              group.setSelected((current) => {
                const next = new Set(current);
                if (checked) next.add(option.id); else next.delete(option.id);
                return next;
              });
            }} type="checkbox" value={option.id} />
            <span className="min-w-0 break-words">{option.label}</span>
          </label>) : <p className="px-2 py-3 text-sm text-black/50">No {group.label.toLowerCase()} available.</p>}
        </div>
      </fieldset>)}
    </fieldset>
  );
}

function ResourceFields({
  options,
  resource,
}: {
  options: OpsAcademyReferenceOptions;
  resource?: OpsAcademyResourceDraft;
}) {
  const slugLocked = Boolean(resource?.publishedAt);
  const [contentType, setContentType] = useState(resource?.contentType ?? "video");
  return (
    <div className="grid gap-4" onInvalidCapture={(event) => {
      // Reveal invalid optional settings before native validation moves focus.
      let disclosure = (event.target as HTMLElement).closest("details");
      while (disclosure) {
        disclosure.open = true;
        disclosure = disclosure.parentElement?.closest("details") ?? null;
      }
    }}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)]">
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Title</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={resource?.title} maxLength={200} minLength={2} name="title" required />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Format</span>
          <select className={OPERATOR_FIELD_CLASS} name="contentType" onChange={(event) => setContentType(event.target.value as OpsAcademyResourceDraft["contentType"])} value={contentType}>
            <option value="video">Video</option>
            <option value="article">Article</option>
            <option value="audio">Audio</option>
            <option value="pdf">PDF</option>
            <option value="download">Download</option>
            <option value="link">External link</option>
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Source link</span>
        <input className={OPERATOR_FIELD_CLASS} defaultValue={resource?.externalUrl ?? ""} name="externalUrl" placeholder="Video, audio, file, or hosted page URL" type="url" />
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Collection</span>
        <select className={OPERATOR_FIELD_CLASS} defaultValue={resource?.collectionId ?? ""} name="collectionId">
          <option value="">No collection</option>
          {options.collections.map((option) => <option disabled={option.status === "retired"} key={option.id} value={option.id}>{option.label}{option.status !== "published" ? ` · ${option.status}` : ""}</option>)}
        </select>
      </label>
      </div>
      <details open={contentType === "article" || Boolean(resource?.bodyText)}>
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Lesson copy</summary>
        <label className={`${OPERATOR_LABEL_CLASS} mt-2`}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Article or supporting notes</span>
          <textarea className={`${OPERATOR_FIELD_CLASS} min-h-28 resize-y`} defaultValue={resource?.bodyText ?? ""} maxLength={100000} name="bodyText" />
        </label>
      </details>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Summary</span>
        <textarea className={`${OPERATOR_FIELD_CLASS} min-h-20 resize-y`} defaultValue={resource?.summary ?? ""} maxLength={2000} name="summary" />
      </label>
      <AudienceFields audiences={resource?.audiences} options={options} />
      <details>
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Presentation &amp; media options</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Position</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={resource?.position ?? 1} max={10000} min={1} name="position" required type="number" />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>URL name</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={resource?.slug ?? ""} disabled={slugLocked} maxLength={160} name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="made-from-title" />
          {slugLocked ? <input name="slug" type="hidden" value={resource?.slug} /> : null}
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Direct video URL</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={resource?.videoUrl ?? ""} name="videoUrl" placeholder="https://...mp4" type="url" />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Thumbnail URL</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={resource?.thumbnailUrl ?? ""} name="thumbnailUrl" placeholder="https://" type="url" />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Captions URL</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={resource?.captionsUrl ?? ""} name="captionsUrl" placeholder="https://...vtt" type="url" />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Presenter</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={resource?.presenter ?? ""} maxLength={160} name="presenter" />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Duration</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={resource?.durationLabel ?? ""} maxLength={40} name="durationLabel" placeholder="08:14" />
        </label>
          <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
            <input defaultChecked={resource?.featured} name="featured" type="checkbox" value="yes" />
            Feature this lesson at the top of the Academy
          </label>
        </div>
      </details>
    </div>
  );
}

export function OperatorAcademyCreateResource({ options, preview = false }: { options: OpsAcademyReferenceOptions; preview?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const pendingRef = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    if (preview) { setMessage("Preview only — no Academy content was changed."); return; }
    pendingRef.current = true;
    setMessage("");
    setSubmitting(true);
    try {
      const result = await academyRequest<{ resource: { resourceId: string } }>(
        "/api/ops/academy/resources",
        resourcePayload(new FormData(event.currentTarget)),
      );
      setDirty(false);
      router.push(`/ops/academy/${result.resource.resourceId}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The lesson draft could not be created.");
    } finally {
      pendingRef.current = false;
      setSubmitting(false);
    }
  }
  return (
    <form className="grid gap-5" data-operator-dirty={dirty} data-operator-pending={submitting} onChange={() => setDirty(true)} onSubmit={submit}>
      <fieldset className="contents" disabled={submitting}>
      <ResourceFields options={options} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span aria-live="polite" className="text-xs text-black/50">{message}</span>
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} type="submit">
          {submitting ? "Creating" : "Create lesson draft"}
        </button>
      </div>
      </fieldset>
    </form>
  );
}

export function OperatorAcademyEditorForm({
  options,
  resource,
  preview = false,
  onSaved,
}: {
  options: OpsAcademyReferenceOptions;
  resource: OpsAcademyResourceDraft;
  preview?: boolean;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const pendingRef = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    if (preview) { setMessage("Preview only — no Academy content was changed."); return; }
    pendingRef.current = true;
    setMessage("");
    setSubmitting(true);
    try {
      await academyRequest(`/api/ops/academy/resources/${resource.resourceId}`, resourcePayload(new FormData(event.currentTarget), resource), "PATCH");
      setMessage("New draft version saved.");
      setDirty(false);
      router.refresh();
      onSaved?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The lesson draft could not be saved.");
    } finally {
      pendingRef.current = false;
      setSubmitting(false);
    }
  }
  return (
    <form className="grid gap-4" data-operator-dirty={dirty} data-operator-pending={submitting} onChange={() => setDirty(true)} onSubmit={submit}>
      <fieldset className="contents" disabled={submitting || resource.status === "retired"}>
      <ResourceFields options={options} resource={resource} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span aria-live="polite" className="text-xs text-black/50">{message}</span>
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting || resource.status === "retired"} type="submit">
          {submitting ? "Saving" : "Save draft"}
        </button>
      </div>
      </fieldset>
    </form>
  );
}

export function OperatorAcademyResourceStateActions({
  resourceId,
  revision,
  status,
  hasUnpublishedChanges = false,
  preview = false,
}: {
  resourceId: string;
  revision: number;
  status: OpsAcademyStatus;
  hasUnpublishedChanges?: boolean;
  preview?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmRetirement, setConfirmRetirement] = useState(false);
  const pendingRef = useRef(false);
  async function change(action: "publish" | "retire" | "unpublish") {
    if (pendingRef.current) return;
    if (preview) { setMessage("Preview only — no Academy content was changed."); return; }
    pendingRef.current = true;
    setSubmitting(true);
    setMessage("");
    try {
      await academyRequest(`/api/ops/academy/resources/${resourceId}/state`, { action, expectedRevision: revision });
      setMessage(action === "publish" ? "Published." : action === "unpublish" ? "Removed from the member Academy." : "Retired.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The lesson state could not be changed.");
    } finally {
      pendingRef.current = false;
      setSubmitting(false);
    }
  }
  if (status === "retired") return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-operator-pending={submitting}>
      {status !== "published" || hasUnpublishedChanges ? (
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={() => change("publish")} type="button">{status === "published" ? "Publish latest changes" : "Publish"}</button>
      ) : null}
      <details className="basis-full">
        <summary className="min-h-11 cursor-pointer content-center text-sm font-medium text-black/60">More actions</summary>
        <div className="flex flex-wrap gap-2">
        {status === "published" ? (
          <button className="min-h-11 rounded-[6px] bg-black/[0.055] px-3 text-sm font-medium" disabled={submitting} onClick={() => change("unpublish")} type="button">Unpublish</button>
        ) : null}
        <button className="min-h-11 rounded-[6px] px-3 text-sm font-medium text-[var(--color-poster)]" disabled={submitting} onClick={() => setConfirmRetirement(true)} type="button">{status === "draft" ? "Discard draft" : "Retire"}</button>
        </div>
      </details>
      {confirmRetirement ? <div className="basis-full rounded-[4px] bg-white p-4 text-black" role="group" aria-label="Confirm lesson retirement"><p className="text-sm">{status === "draft" ? "Discard this unused lesson draft?" : "Retire this lesson and remove it from the Academy?"} Its history is retained. This cannot be undone.</p><div className="mt-3 flex gap-3"><button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={() => change("retire")} type="button">{status === "draft" ? "Confirm discard" : "Confirm retirement"}</button><button className="min-h-11 text-sm underline" disabled={submitting} onClick={() => setConfirmRetirement(false)} type="button">Keep lesson</button></div></div> : null}
      <span aria-live="polite" className="text-xs text-black/48">{message}</span>
    </div>
  );
}

export function OperatorAcademyCollectionCreate({ preview = false, onCreated }: { preview?: boolean; onCreated?: () => void }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const pendingRef = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    if (preview) { setMessage("Preview only — no Academy content was changed."); return; }
    pendingRef.current = true;
    setSubmitting(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await academyRequest("/api/ops/academy/collections", {
        name: String(data.get("name") ?? ""),
        position: Number(data.get("position") ?? 1),
        slug: String(data.get("slug") ?? ""),
        summary: String(data.get("summary") ?? ""),
      });
      form.reset();
      setDirty(false);
      setMessage("Collection draft created.");
      router.refresh();
      onCreated?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The collection could not be created.");
    } finally {
      pendingRef.current = false;
      setSubmitting(false);
    }
  }
  return (
    <form className="grid gap-4 sm:grid-cols-2" data-operator-dirty={dirty} data-operator-pending={submitting} onChange={() => setDirty(true)} onSubmit={submit}>
      <fieldset className="contents" disabled={submitting}>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Collection name</span>
        <input className={OPERATOR_FIELD_CLASS} maxLength={160} minLength={2} name="name" required />
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>URL name</span>
        <input className={OPERATOR_FIELD_CLASS} name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="made-from-name" />
      </label>
      <label className={`${OPERATOR_LABEL_CLASS} sm:col-span-2`}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Summary</span>
        <textarea className={`${OPERATOR_FIELD_CLASS} min-h-20 resize-y`} maxLength={2000} name="summary" />
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Position</span>
        <input className={OPERATOR_FIELD_CLASS} defaultValue={1} max={10000} min={1} name="position" required type="number" />
      </label>
      <div className="flex items-end justify-end">
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} type="submit">Create collection</button>
      </div>
      <span aria-live="polite" className="text-xs text-black/48 sm:col-span-2">{message}</span>
      </fieldset>
    </form>
  );
}

export function OperatorAcademyCollectionActions({ collection, preview = false, expanded = false }: { collection: OpsAcademyCollection; preview?: boolean; expanded?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmRetirement, setConfirmRetirement] = useState(false);
  const [dirty, setDirty] = useState(false);
  const pendingRef = useRef(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    if (preview) { setMessage("Preview only — no Academy content was changed."); return; }
    pendingRef.current = true;
    setSubmitting(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      await academyRequest(`/api/ops/academy/collections/${collection.collectionId}`, {
        expectedRevision: collection.revision,
        name: String(data.get("name") ?? ""),
        position: Number(data.get("position") ?? 1),
        slug: String(data.get("slug") ?? ""),
        summary: String(data.get("summary") ?? ""),
      }, "PATCH");
      setDirty(false);
      setMessage("Collection saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The collection could not be saved.");
    } finally {
      pendingRef.current = false;
      setSubmitting(false);
    }
  }
  async function change(action: "publish" | "retire" | "unpublish") {
    if (pendingRef.current) return;
    if (preview) { setMessage("Preview only — no Academy content was changed."); return; }
    if (dirty) { setMessage("Save your collection changes before changing its status."); return; }
    pendingRef.current = true;
    setSubmitting(true);
    setMessage("");
    try {
      await academyRequest(`/api/ops/academy/collections/${collection.collectionId}`, {
        action,
        expectedRevision: collection.revision,
      });
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The collection could not be changed.");
    } finally {
      pendingRef.current = false;
      setSubmitting(false);
    }
  }
  if (collection.status === "retired") return null;
  const form = (
      <form className="grid gap-3 pt-3" data-operator-dirty={dirty} data-operator-pending={submitting} onChange={() => setDirty(true)} onSubmit={save}>
        <fieldset className="contents" disabled={submitting}>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Name</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={collection.name} maxLength={160} minLength={2} name="name" required />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>URL name</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={collection.slug} disabled={Boolean(collection.publishedAt)} name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required />
          {collection.publishedAt ? <input name="slug" type="hidden" value={collection.slug} /> : null}
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Summary</span>
          <textarea className={`${OPERATOR_FIELD_CLASS} min-h-20 resize-y`} defaultValue={collection.summary ?? ""} maxLength={2000} name="summary" />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Position</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={collection.position} max={10000} min={1} name="position" required type="number" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} type="submit">Save</button>
          {collection.status !== "published" ? (
            <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={() => change("publish")} type="button">Publish</button>
          ) : (
            <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={() => change("unpublish")} type="button">Unpublish</button>
          )}
          <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={() => setConfirmRetirement(true)} type="button">{collection.status === "draft" ? "Discard draft" : "Retire"}</button>
        </div>
        {confirmRetirement ? <div className="rounded-[4px] bg-white p-3" role="group" aria-label="Confirm collection retirement"><p className="text-sm">Retire this collection? Move its remaining lessons first. Its history is retained and this cannot be undone.</p><div className="mt-3 flex gap-3"><button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={() => change("retire")} type="button">Confirm retirement</button><button className="min-h-11 text-sm underline" disabled={submitting} onClick={() => setConfirmRetirement(false)} type="button">Keep collection</button></div></div> : null}
        <span aria-live="polite" className="text-xs text-black/48">{message}</span>
        </fieldset>
      </form>
  );
  if (expanded) return form;
  return (
    <details className="group mt-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-black/60 marker:content-none">
        Edit collection <span aria-hidden="true" className="ml-2 transition-transform group-open:rotate-45">+</span>
      </summary>
      {form}
    </details>
  );
}
