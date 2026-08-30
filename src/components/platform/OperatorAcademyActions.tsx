"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

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
  const allMembers = audiences.some((audience) => audience.kind === "all_members");
  const circleIds = new Set(audiences.filter((audience) => audience.kind === "circle").map((audience) => audience.id));
  const blockIds = new Set(audiences.filter((audience) => audience.kind === "block").map((audience) => audience.id));
  return (
    <fieldset className="grid gap-3 rounded-[4px] bg-black/[0.035] p-4 sm:grid-cols-2">
      <legend className="px-1 font-[var(--font-display)] text-xl tracking-[-0.02em]">Audience</legend>
      <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
        <input defaultChecked={allMembers} name="audienceAll" type="checkbox" value="yes" />
        All active members
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Circles</span>
        <select className={`${OPERATOR_FIELD_CLASS} min-h-28`} defaultValue={[...circleIds].filter(Boolean) as string[]} multiple name="circleIds">
          {options.circles.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Blocks</span>
        <select className={`${OPERATOR_FIELD_CLASS} min-h-28`} defaultValue={[...blockIds].filter(Boolean) as string[]} multiple name="blockIds">
          {options.blocks.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <p className="text-xs leading-relaxed text-black/45 sm:col-span-2">
        All members is exclusive. Otherwise use Command or Control to choose more than one Circle or Block.
      </p>
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
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)]">
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Title</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={resource?.title} maxLength={200} minLength={2} name="title" required />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Format</span>
          <select className={OPERATOR_FIELD_CLASS} defaultValue={resource?.contentType ?? "video"} name="contentType">
            <option value="video">Video</option>
            <option value="article">Article</option>
            <option value="audio">Audio</option>
            <option value="pdf">PDF</option>
            <option value="download">Download</option>
            <option value="link">External link</option>
          </select>
        </label>
      </div>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Summary</span>
        <textarea className={`${OPERATOR_FIELD_CLASS} min-h-24 resize-y`} defaultValue={resource?.summary ?? ""} maxLength={2000} name="summary" />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Collection</span>
          <select className={OPERATOR_FIELD_CLASS} defaultValue={resource?.collectionId ?? ""} name="collectionId">
            <option value="">No collection</option>
            {options.collections.map((option) => (
              <option disabled={option.status === "retired"} key={option.id} value={option.id}>
                {option.label}{option.status !== "published" ? ` · ${option.status}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Position</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={resource?.position ?? 1} max={10000} min={1} name="position" required type="number" />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>URL name</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={resource?.slug ?? ""} disabled={slugLocked} maxLength={160} name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="made-from-title" />
          {slugLocked ? <input name="slug" type="hidden" value={resource?.slug} /> : null}
        </label>
      </div>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Lesson copy</span>
        <textarea className={`${OPERATOR_FIELD_CLASS} min-h-44 resize-y`} defaultValue={resource?.bodyText ?? ""} maxLength={100000} name="bodyText" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Resource, download, or hosted page URL</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={resource?.externalUrl ?? ""} name="externalUrl" placeholder="https://" type="url" />
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
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input defaultChecked={resource?.featured} name="featured" type="checkbox" value="yes" />
        Feature this lesson at the top of the Academy
      </label>
      <AudienceFields audiences={resource?.audiences} options={options} />
    </div>
  );
}

export function OperatorAcademyCreateResource({ options }: { options: OpsAcademyReferenceOptions }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);
    try {
      const result = await academyRequest<{ resource: { resourceId: string } }>(
        "/api/ops/academy/resources",
        resourcePayload(new FormData(event.currentTarget)),
      );
      router.push(`/ops/academy/${result.resource.resourceId}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The lesson draft could not be created.");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form className="grid gap-5" onSubmit={submit}>
      <ResourceFields options={options} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span aria-live="polite" className="text-xs text-black/50">{message}</span>
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} type="submit">
          {submitting ? "Creating" : "Create lesson draft"}
        </button>
      </div>
    </form>
  );
}

export function OperatorAcademyEditorForm({
  options,
  resource,
}: {
  options: OpsAcademyReferenceOptions;
  resource: OpsAcademyResourceDraft;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);
    try {
      await academyRequest(`/api/ops/academy/resources/${resource.resourceId}`, resourcePayload(new FormData(event.currentTarget), resource), "PATCH");
      setMessage("New draft version saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The lesson draft could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form className="grid gap-5" onSubmit={submit}>
      <ResourceFields options={options} resource={resource} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span aria-live="polite" className="text-xs text-black/50">{message}</span>
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting || resource.status === "retired"} type="submit">
          {submitting ? "Saving" : "Save new draft version"}
        </button>
      </div>
    </form>
  );
}

export function OperatorAcademyResourceStateActions({
  resourceId,
  revision,
  status,
}: {
  resourceId: string;
  revision: number;
  status: OpsAcademyStatus;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function change(action: "publish" | "retire" | "unpublish") {
    setSubmitting(true);
    setMessage("");
    try {
      await academyRequest(`/api/ops/academy/resources/${resourceId}/state`, { action, expectedRevision: revision });
      setMessage(action === "publish" ? "Published." : action === "unpublish" ? "Removed from the member Academy." : "Retired.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The lesson state could not be changed.");
    } finally {
      setSubmitting(false);
    }
  }
  if (status === "retired") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "published" ? (
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={() => change("publish")} type="button">Publish</button>
      ) : (
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={() => change("unpublish")} type="button">Unpublish</button>
      )}
      {status !== "draft" ? (
        <button className={`${OPERATOR_BUTTON_CLASS} border-[var(--color-poster)] text-[var(--color-poster)]`} disabled={submitting} onClick={() => change("retire")} type="button">Retire</button>
      ) : null}
      <span aria-live="polite" className="text-xs text-black/48">{message}</span>
    </div>
  );
}

export function OperatorAcademyCollectionCreate() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setMessage("Collection draft created.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The collection could not be created.");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
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
    </form>
  );
}

export function OperatorAcademyCollectionActions({ collection }: { collection: OpsAcademyCollection }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setMessage("Collection saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The collection could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }
  async function change(action: "publish" | "retire" | "unpublish") {
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
      setSubmitting(false);
    }
  }
  if (collection.status === "retired") return null;
  return (
    <details className="group mt-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs uppercase tracking-[0.1em] text-black/48 marker:content-none">
        Edit collection <span aria-hidden="true" className="ml-2 transition-transform group-open:rotate-45">+</span>
      </summary>
      <form className="grid gap-3 pt-3" onSubmit={save}>
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
          {collection.status !== "draft" ? (
            <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={() => change("retire")} type="button">Retire</button>
          ) : null}
        </div>
        <span aria-live="polite" className="text-xs text-black/48">{message}</span>
      </form>
    </details>
  );
}
