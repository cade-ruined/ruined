"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useRef, useState } from "react";

import {
  OPERATOR_BUTTON_CLASS,
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
  OPERATOR_PRIMARY_ACTION_CLASS,
} from "@/components/platform/operatorStyles";
import type { OpsArtifactQueueItem } from "@/lib/platform/ops-model";
import { isLiveAwardableArtifactTemplate } from "@/lib/platform/artifact-invariants";
import type { OpsArtifactControlData } from "@/lib/platform/ops-artifact-repository";

async function actionRequest<Result = unknown>(url: string, body: unknown, method = "POST"): Promise<Result> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
  const result = (await response.json().catch(() => null)) as ({ error?: unknown } & Result) | null;
  if (!response.ok) {
    throw new Error(typeof result?.error === "string" ? result.error : "The action could not be completed.");
  }
  return (result ?? {}) as Result;
}

function Notice({ message }: { message: string }) {
  return <span aria-live="polite" className="text-xs text-black/48">{message}</span>;
}

function TemplateCreateForm() {
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
      await actionRequest("/api/ops/artifact-templates", {
        description: String(data.get("description") ?? ""),
        livemode: data.get("livemode") === "on",
        name: String(data.get("name") ?? ""),
        productGid: String(data.get("productGid") ?? ""),
        productHandle: String(data.get("productHandle") ?? ""),
        slug: String(data.get("slug") ?? ""),
      });
      form.reset();
      setMessage("Template published and bound to Shopify.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The template could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Name</span>
        <input className={OPERATOR_FIELD_CLASS} maxLength={200} minLength={2} name="name" required />
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Slug</span>
        <input className={OPERATOR_FIELD_CLASS} maxLength={120} name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="the-first-coin" required />
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Shopify Product GID</span>
        <input className={OPERATOR_FIELD_CLASS} name="productGid" placeholder="gid://shopify/Product/…" required />
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Shopify handle</span>
        <input className={OPERATOR_FIELD_CLASS} name="productHandle" placeholder="the-first-coin" required />
      </label>
      <label className={`${OPERATOR_LABEL_CLASS} sm:col-span-2`}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Description</span>
        <textarea className={`${OPERATOR_FIELD_CLASS} min-h-24 resize-y`} maxLength={2000} name="description" />
      </label>
      <label className="flex min-h-12 items-center gap-3 text-sm text-black/65">
        <input className="size-4 accent-black" defaultChecked name="livemode" type="checkbox" />
        Live Shopify product
      </label>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Notice message={message} />
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} type="submit">
          {submitting ? "Publishing" : "Publish template"}
        </button>
      </div>
    </form>
  );
}

function ShopifyBindingForm({
  livemode,
  productGid,
  productHandle,
  templateId,
}: {
  livemode: boolean | null;
  productGid: string | null;
  productHandle: string | null;
  templateId: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      await actionRequest(`/api/ops/artifact-templates/${templateId}/shopify`, {
        livemode: data.get("livemode") === "on",
        productGid: String(data.get("productGid") ?? ""),
        productHandle: String(data.get("productHandle") ?? ""),
      }, "PATCH");
      setMessage("New version published.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The binding could not be updated.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_0.7fr_auto] sm:items-end" onSubmit={submit}>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Product GID</span>
        <input className={OPERATOR_FIELD_CLASS} defaultValue={productGid ?? ""} name="productGid" required />
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Handle</span>
        <input className={OPERATOR_FIELD_CLASS} defaultValue={productHandle ?? ""} name="productHandle" required />
      </label>
      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-xs text-black/58">
          <input className="size-4 accent-black" defaultChecked={livemode ?? true} name="livemode" type="checkbox" /> Live
        </label>
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} type="submit">Bind</button>
      </div>
      <Notice message={message} />
    </form>
  );
}

function ArtifactAwardForm({ data }: { data: OpsArtifactControlData }) {
  const router = useRouter();
  const requestKey = useRef("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const availableTemplates = data.templates.filter(isLiveAwardableArtifactTemplate);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const form = event.currentTarget;
    const payload = new FormData(form);
    requestKey.current ||= crypto.randomUUID();
    try {
      const result = await actionRequest<{ award?: { replayed?: boolean } }>("/api/ops/artifact-awards", {
        acquisitionType: String(payload.get("acquisitionType") ?? "earned"),
        memberId: String(payload.get("memberId") ?? ""),
        reason: String(payload.get("reason") ?? ""),
        requestKey: requestKey.current,
        templateVersionId: String(payload.get("templateVersionId") ?? ""),
      });
      form.reset();
      requestKey.current = "";
      setMessage(result.award?.replayed ? "That award was already recorded." : "Artifact awarded and production work opened.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Artifact could not be awarded.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4 sm:grid-cols-3" onSubmit={submit}>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Member</span>
        <select className={OPERATOR_FIELD_CLASS} name="memberId" required>
          <option value="">Choose member</option>
          {data.members.map((member) => <option key={member.memberId} value={member.memberId}>{member.name}</option>)}
        </select>
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Artifact</span>
        <select className={OPERATOR_FIELD_CLASS} name="templateVersionId" required>
          <option value="">Choose template</option>
          {availableTemplates.map((template) => <option key={template.versionId!} value={template.versionId!}>{template.name} / v{template.version}</option>)}
        </select>
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>How acquired</span>
        <select className={OPERATOR_FIELD_CLASS} defaultValue="earned" name="acquisitionType">
          <option value="earned">Earned</option>
          <option value="gifted">Gifted</option>
          <option value="purchased">Purchased</option>
        </select>
      </label>
      <label className={`${OPERATOR_LABEL_CLASS} sm:col-span-3`}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Why they receive it</span>
        <textarea className={`${OPERATOR_FIELD_CLASS} min-h-24 resize-y`} maxLength={2000} minLength={3} name="reason" required />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-3">
        <Notice message={message} />
        <button className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={submitting || data.members.length === 0 || availableTemplates.length === 0} type="submit">
          {submitting ? "Awarding" : "Award Artifact"}
        </button>
      </div>
    </form>
  );
}

function ShipmentCreateForm({ artifacts }: { artifacts: OpsArtifactQueueItem[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const jobs = artifacts.filter((artifact) => artifact.artifactJobId && artifact.state !== "canceled");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await actionRequest("/api/ops/artifact-shipments", {
        artifactJobId: String(data.get("artifactJobId") ?? ""),
        carrier: String(data.get("carrier") ?? ""),
        serviceLevel: String(data.get("serviceLevel") ?? ""),
        trackingNumber: String(data.get("trackingNumber") ?? ""),
        trackingUrl: String(data.get("trackingUrl") ?? ""),
      });
      form.reset();
      setMessage("Tracking added.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tracking could not be added.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={submit}>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Production job</span>
        <select className={OPERATOR_FIELD_CLASS} name="artifactJobId" required>
          <option value="">Choose Artifact</option>
          {jobs.map((artifact) => <option key={artifact.artifactJobId!} value={artifact.artifactJobId!}>{artifact.name} · {artifact.memberName}</option>)}
        </select>
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Carrier</span>
        <input className={OPERATOR_FIELD_CLASS} maxLength={120} name="carrier" placeholder="UPS" required />
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Service</span>
        <input className={OPERATOR_FIELD_CLASS} maxLength={120} name="serviceLevel" placeholder="Ground" />
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Tracking number</span>
        <input className={OPERATOR_FIELD_CLASS} maxLength={240} minLength={3} name="trackingNumber" required />
      </label>
      <label className={`${OPERATOR_LABEL_CLASS} lg:col-span-2`}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Tracking link</span>
        <input className={OPERATOR_FIELD_CLASS} name="trackingUrl" placeholder="https://…" type="url" />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2 lg:col-span-3">
        <Notice message={message} />
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting || jobs.length === 0} type="submit">Add tracking</button>
      </div>
    </form>
  );
}

const SHIPMENT_STATUS_OPTIONS: Record<string, Array<{ label: string; value: string }>> = {
  exception: [
    { label: "Exception", value: "exception" },
    { label: "In transit", value: "in_transit" },
    { label: "Delivered", value: "delivered" },
    { label: "Returned", value: "returned" },
    { label: "Cancelled", value: "cancelled" },
  ],
  in_transit: [
    { label: "In transit", value: "in_transit" },
    { label: "Delivered", value: "delivered" },
    { label: "Exception", value: "exception" },
    { label: "Returned", value: "returned" },
  ],
  label_created: [
    { label: "Label created", value: "label_created" },
    { label: "In transit", value: "in_transit" },
    { label: "Delivered", value: "delivered" },
    { label: "Exception", value: "exception" },
    { label: "Cancelled", value: "cancelled" },
  ],
};

function ShipmentUpdateForm({ shipment }: { shipment: OpsArtifactControlData["shipments"][number] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      await actionRequest(`/api/ops/artifact-shipments/${shipment.shipmentId}`, {
        carrier: String(data.get("carrier") ?? ""),
        changeReason: String(data.get("changeReason") ?? ""),
        expectedVersion: shipment.version,
        serviceLevel: String(data.get("serviceLevel") ?? ""),
        status: String(data.get("status") ?? ""),
        trackingNumber: String(data.get("trackingNumber") ?? ""),
        trackingUrl: String(data.get("trackingUrl") ?? ""),
      }, "PATCH");
      setMessage("Shipment and evidence updated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Shipment could not be updated.");
    } finally {
      setSubmitting(false);
    }
  }
  const statusOptions = SHIPMENT_STATUS_OPTIONS[shipment.status]
    ?? [{ label: shipment.status.replaceAll("_", " "), value: shipment.status }];
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={update}>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Carrier</span>
        <input className={OPERATOR_FIELD_CLASS} defaultValue={shipment.carrier} maxLength={120} name="carrier" required />
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Service</span>
        <input className={OPERATOR_FIELD_CLASS} defaultValue={shipment.serviceLevel ?? ""} maxLength={120} name="serviceLevel" />
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Status</span>
        <select className={OPERATOR_FIELD_CLASS} defaultValue={shipment.status} name="status">
          {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Tracking number</span>
        <input className={OPERATOR_FIELD_CLASS} defaultValue={shipment.trackingNumber} maxLength={240} minLength={3} name="trackingNumber" required />
      </label>
      <label className={`${OPERATOR_LABEL_CLASS} sm:col-span-2`}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Tracking link</span>
        <input className={OPERATOR_FIELD_CLASS} defaultValue={shipment.trackingUrl ?? ""} name="trackingUrl" type="url" />
      </label>
      <label className={`${OPERATOR_LABEL_CLASS} sm:col-span-2 lg:col-span-3`}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Why this changed</span>
        <input className={OPERATOR_FIELD_CLASS} maxLength={500} minLength={3} name="changeReason" placeholder="Carrier correction, scan update, delivery confirmed…" required />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2 lg:col-span-3">
        <Notice message={message} />
        <button className={`${OPERATOR_BUTTON_CLASS} min-h-10 px-3 py-2`} disabled={submitting} type="submit">Save shipment</button>
      </div>
    </form>
  );
}

export default function OperatorArtifactAdmin({
  artifacts,
  data,
}: {
  artifacts: OpsArtifactQueueItem[];
  data: OpsArtifactControlData;
}) {
  const counts = useMemo(() => ({
    shipments: data.shipments.filter((shipment) => !["delivered", "cancelled", "returned"].includes(shipment.status)).length,
    templates: data.templates.filter((template) => template.status === "active").length,
    unbound: data.templates.filter((template) => !template.productGid || !template.productHandle).length,
  }), [data]);

  return (
    <section className="mb-10 space-y-6" aria-label="Artifact controls">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-[4px] bg-black px-4 py-5 text-[var(--color-bone)]"><strong className="block text-3xl">{counts.templates}</strong><span className="text-[0.62rem] uppercase tracking-[0.12em] text-white/55">Templates</span></div>
        <div className="rounded-[4px] bg-[var(--color-shop)] px-4 py-5"><strong className="block text-3xl">{counts.unbound}</strong><span className="text-[0.62rem] uppercase tracking-[0.12em] text-black/55">Unbound</span></div>
        <div className="rounded-[4px] bg-[var(--color-workwear)] px-4 py-5"><strong className="block text-3xl">{counts.shipments}</strong><span className="text-[0.62rem] uppercase tracking-[0.12em] text-black/55">In motion</span></div>
      </div>

      <details className="group rounded-[4px] bg-[var(--color-highlight)] shadow-[5px_5px_0_#080605]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-5 px-5 py-5 marker:hidden sm:px-6">
          <span><strong className="block font-[var(--font-display)] text-2xl leading-none">Award an Artifact</strong><span className="mt-2 block text-xs text-black/55">Choose the member, the Artifact, and the reason it was earned.</span></span>
          <span aria-hidden="true" className="text-2xl transition-transform group-open:rotate-45">＋</span>
        </summary>
        <div className="bg-white/35 px-5 py-6 sm:px-6"><ArtifactAwardForm data={data} /></div>
      </details>

      <details className="group rounded-[4px] bg-black/[0.035]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-5 px-5 py-5 marker:hidden sm:px-6">
          <span><strong className="ui-heading block text-xl font-semibold">Templates + Shopify</strong><span className="mt-1 block text-xs text-black/45">Bind the physical product members receive.</span></span>
          <span aria-hidden="true" className="text-2xl text-black/40 transition-transform group-open:rotate-45">＋</span>
        </summary>
        <div className="space-y-3 px-5 pb-6 sm:px-6">
          {data.templates.map((template) => (
            <article className="rounded-[4px] bg-white/35 p-4" key={template.templateId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="ui-heading text-lg font-semibold">{template.name}</h3><p className="mt-1 text-xs text-black/48">{template.templateSlug} · v{template.version ?? "—"} · {template.versionStatus ?? "no version"}</p></div>
                <span className={`px-2 py-1 text-[0.58rem] uppercase tracking-[0.12em] ${template.bindingVerified && template.livemode ? "bg-[var(--color-verdigris)] text-white" : template.bindingVerified ? "bg-[var(--color-shop)] text-black" : "bg-[var(--color-poster)] text-white"}`}>{template.bindingVerified ? template.livemode ? "Live binding" : "Test only" : "Needs valid binding"}</span>
              </div>
              <ShopifyBindingForm livemode={template.livemode} productGid={template.productGid} productHandle={template.productHandle} templateId={template.templateId} />
            </article>
          ))}
          <details className="rounded-[4px] bg-white/35 p-4"><summary className="cursor-pointer ui-heading text-sm font-semibold uppercase tracking-[0.1em]">New template</summary><div className="mt-5"><TemplateCreateForm /></div></details>
        </div>
      </details>

      <details className="group rounded-[4px] bg-black/[0.035]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-5 px-5 py-5 marker:hidden sm:px-6">
          <span><strong className="ui-heading block text-xl font-semibold">Fulfillment + tracking</strong><span className="mt-1 block text-xs text-black/45">Add shipping evidence and update delivery status.</span></span>
          <span aria-hidden="true" className="text-2xl text-black/40 transition-transform group-open:rotate-45">＋</span>
        </summary>
        <div className="space-y-4 px-5 pb-6 sm:px-6">
          <ShipmentCreateForm artifacts={artifacts} />
          {data.shipments.map((shipment) => (
            <article className="space-y-4 rounded-[4px] bg-white/35 p-4" key={shipment.shipmentId}>
              <div className="flex flex-wrap items-start justify-between gap-3"><div><strong className="ui-heading text-sm font-semibold">{shipment.memberName}</strong><p className="mt-1 text-xs text-black/48">{shipment.carrier}{shipment.serviceLevel ? ` · ${shipment.serviceLevel}` : ""} · {shipment.trackingNumber}</p></div>{shipment.trackingUrl ? <a className="text-sm underline underline-offset-4" href={shipment.trackingUrl} rel="noreferrer" target="_blank">Open tracking ↗</a> : <span className="text-xs text-black/40">No tracking link</span>}</div>
              <ShipmentUpdateForm shipment={shipment} />
            </article>
          ))}
        </div>
      </details>
    </section>
  );
}
