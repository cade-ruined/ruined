"use client";

import { useRouter } from "next/navigation";
import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";

import OperatorDialog from "@/components/platform/OperatorDialog";
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
import OperatorArtifactProductPicker, { type ArtifactProductSelection } from "@/components/platform/OperatorArtifactProductPicker";

const ArtifactPreviewContext = createContext(false);

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

function TemplateCreateForm({ onSuccess }: { onSuccess?: (message: string) => void } = {}) {
  const preview = useContext(ArtifactPreviewContext);
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [product, setProduct] = useState<ArtifactProductSelection | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (preview) { setMessage("Preview only — no Artifact or shipment was changed."); return; }
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
      setProduct(null);
      setDirty(false);
      setMessage("Template published and bound to Shopify.");
      router.refresh();
      onSuccess?.("Template published and bound to Shopify.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The template could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4 sm:grid-cols-2" data-operator-dirty={dirty ? "true" : undefined} data-operator-pending={submitting ? "true" : undefined} onChange={() => setDirty(true)} onSubmit={submit}>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Name</span>
        <input className={OPERATOR_FIELD_CLASS} maxLength={200} minLength={2} name="name" required />
      </label>
      <input type="hidden" name="slug" value={product?.handle ?? ""} />
      <OperatorArtifactProductPicker selected={product} onSelect={(value) => { setProduct(value); setDirty(true); }} disabled={submitting} preview={preview} />
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
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting || !product} type="submit">
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
  const preview = useContext(ArtifactPreviewContext);
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [product, setProduct] = useState<ArtifactProductSelection | null>(productGid && productHandle ? { id: productGid, handle: productHandle, title: productHandle.replaceAll("-", " ") } : null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (preview) { setMessage("Preview only — no Artifact or shipment was changed."); return; }
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
      setDirty(false);
      setEditing(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The binding could not be updated.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) return <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
    <div><p className="text-sm text-black/65">{productGid && productHandle ? `Shopify · ${productHandle.replaceAll("-", " ")}` : "No Shopify product connected"}</p>{message ? <Notice message={message} /> : null}</div>
    <button id={`edit-artifact-product-${templateId}`} className="min-h-11 px-2 text-sm underline underline-offset-4" onClick={() => { setEditing(true); setDirty(false); setMessage(""); setProduct(productGid && productHandle ? { id: productGid, handle: productHandle, title: productHandle.replaceAll("-", " ") } : null); }} type="button">{productGid && productHandle ? "Edit product" : "Connect product"}</button>
  </div>;
  return (
    <OperatorDialog open title="Shopify product" onClose={() => { setEditing(false); setMessage(""); }} pending={submitting} returnFocusId={`edit-artifact-product-${templateId}`}>
    <form className="grid gap-4 sm:grid-cols-2" data-operator-dirty={dirty ? "true" : undefined} data-operator-pending={submitting ? "true" : undefined} onChange={() => setDirty(true)} onSubmit={submit}>
      <OperatorArtifactProductPicker selected={product} onSelect={(value) => { setProduct(value); setDirty(true); }} disabled={submitting} preview={preview} />
      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-xs text-black/58">
          <input className="size-4 accent-black" defaultChecked={livemode ?? true} name="livemode" type="checkbox" /> Live
        </label>
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting || !product} type="submit">Save product</button>
      </div>
      <Notice message={message} />
    </form>
    </OperatorDialog>
  );
}

function ArtifactAwardForm({ data, onSuccess }: { data: OpsArtifactControlData; onSuccess?: (message: string) => void }) {
  const preview = useContext(ArtifactPreviewContext);
  const router = useRouter();
  const requestKey = useRef("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const availableTemplates = data.templates.filter(isLiveAwardableArtifactTemplate);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (preview) { setMessage("Preview only — no Artifact or shipment was changed."); return; }
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
      setDirty(false);
      setMessage(result.award?.replayed ? "That award was already recorded." : "Artifact awarded and production work opened.");
      router.refresh();
      onSuccess?.(result.award?.replayed ? "That award was already recorded." : "Artifact awarded and production work opened.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Artifact could not be awarded.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4 sm:grid-cols-3" data-operator-dirty={dirty ? "true" : undefined} data-operator-pending={submitting ? "true" : undefined} onChange={() => setDirty(true)} onSubmit={submit}>
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

function ShipmentCreateForm({ artifacts, onSuccess }: { artifacts: OpsArtifactQueueItem[]; onSuccess?: (message: string) => void }) {
  const preview = useContext(ArtifactPreviewContext);
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const jobs = artifacts.filter((artifact) => artifact.artifactJobId && artifact.state !== "canceled");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (preview) { setMessage("Preview only — no Artifact or shipment was changed."); return; }
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
      setDirty(false);
      setMessage("Tracking added.");
      router.refresh();
      onSuccess?.("Tracking added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tracking could not be added.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-operator-dirty={dirty ? "true" : undefined} data-operator-pending={submitting ? "true" : undefined} onChange={() => setDirty(true)} onSubmit={submit}>
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
  const preview = useContext(ArtifactPreviewContext);
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (preview) { setMessage("Preview only — no Artifact or shipment was changed."); return; }
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
      setDirty(false);
      setEditing(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Shipment could not be updated.");
    } finally {
      setSubmitting(false);
    }
  }
  const statusOptions = SHIPMENT_STATUS_OPTIONS[shipment.status]
    ?? [{ label: shipment.status.replaceAll("_", " "), value: shipment.status }];
  if (!editing) return <div className="flex flex-wrap items-center justify-between gap-3"><Notice message={message} /><button id={`edit-artifact-shipment-${shipment.shipmentId}`} className="min-h-11 px-2 text-sm underline underline-offset-4" onClick={() => { setEditing(true); setDirty(false); setMessage(""); }} type="button">Edit shipment</button></div>;
  return (
    <OperatorDialog open title="Edit shipment" onClose={() => { setEditing(false); setMessage(""); }} pending={submitting} returnFocusId={`edit-artifact-shipment-${shipment.shipmentId}`}>
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-operator-dirty={dirty ? "true" : undefined} data-operator-pending={submitting ? "true" : undefined} onChange={() => setDirty(true)} onSubmit={update}>
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
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} type="submit">Save shipment</button>
      </div>
    </form>
    </OperatorDialog>
  );
}

export default function OperatorArtifactAdmin({
  artifacts,
  data,
  production,
  preview = false,
}: {
  artifacts: OpsArtifactQueueItem[];
  data: OpsArtifactControlData;
  production?: ReactNode;
  preview?: boolean;
}) {
  const [view, setView] = useState<"production" | "templates" | "shipping">("production");
  const [task, setTask] = useState<"award" | "template" | "shipment" | null>(null);
  const [notice, setNotice] = useState("");
  const counts = useMemo(() => ({
    shipments: data.shipments.filter((shipment) => !["delivered", "cancelled", "returned"].includes(shipment.status)).length,
    exceptions: data.shipments.filter((shipment) => shipment.status === "exception").length,
    unbound: data.templates.filter((template) => template.status === "active" && !isLiveAwardableArtifactTemplate(template)).length,
  }), [data]);

  useEffect(() => {
    const syncHash = () => {
      const hash = window.location.hash;
      if (hash === "#award-artifact") setTask("award");
      else if (hash === "#new-artifact-template") { setView("templates"); setTask("template"); }
      else if (hash === "#new-artifact-shipment") { setView("shipping"); setTask("shipment"); }
      else if (hash === "#artifact-templates") setView("templates");
      else if (hash === "#artifact-fulfillment") setView("shipping");
      else if (hash === "#artifact-production" || hash.startsWith("#artifact-")) {
        setView("production");
        if (hash !== "#artifact-production") requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" }));
      }
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    window.addEventListener("popstate", syncHash);
    return () => { window.removeEventListener("hashchange", syncHash); window.removeEventListener("popstate", syncHash); };
  }, []);

  const viewHash = (nextView: typeof view) => nextView === "templates" ? "artifact-templates" : nextView === "shipping" ? "artifact-fulfillment" : "artifact-production";
  function replaceHash(hash: string) {
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${hash}`);
  }
  function changeView(nextView: typeof view) { setView(nextView); replaceHash(viewHash(nextView)); }
  function openTask(nextTask: NonNullable<typeof task>) {
    setTask(nextTask);
    replaceHash(nextTask === "award" ? "award-artifact" : nextTask === "template" ? "new-artifact-template" : "new-artifact-shipment");
  }
  function closeTask() { setTask(null); replaceHash(viewHash(view)); }
  function taskSucceeded(message: string) {
    const nextView = task === "award" ? "production" : task === "template" ? "templates" : "shipping";
    setNotice(message); setTask(null); changeView(nextView);
  }

  return (
    <ArtifactPreviewContext.Provider value={preview}>
    <section className="space-y-3" aria-label="Artifact controls">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Artifact views" className="flex flex-wrap items-center gap-1 rounded-[5px] bg-black/[0.045] p-1">
          {(["production", "templates", "shipping"] as const).map((item) => <a className={`inline-flex min-h-11 items-center rounded-[4px] px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${view === item ? "bg-[var(--color-faded)] text-[var(--color-bone)]" : "text-black/65 hover:bg-black/5"}`} href={`#${viewHash(item)}`} aria-current={view === item ? "page" : undefined} key={item} onClick={(event) => { event.preventDefault(); changeView(item); }}>{item === "production" ? "Production" : item === "templates" ? "Templates" : "Shipping"}</a>)}
        </nav>
        <button id="open-award-artifact" className={OPERATOR_PRIMARY_ACTION_CLASS} onClick={() => openTask("award")} type="button">Award an Artifact</button>
      </div>
      {notice ? <p className="text-sm text-[var(--color-verdigris)]" role="status">{notice}</p> : null}
      {counts.exceptions || counts.unbound ? <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--color-poster)]" aria-label="Artifact attention">
        {counts.exceptions ? <a className="min-h-11 content-center underline underline-offset-4" href="#artifact-fulfillment" onClick={(event) => { event.preventDefault(); changeView("shipping"); }}>{counts.exceptions} {counts.exceptions === 1 ? "shipment needs" : "shipments need"} attention →</a> : null}
        {counts.unbound ? <a className="min-h-11 content-center underline underline-offset-4" href="#artifact-templates" onClick={(event) => { event.preventDefault(); changeView("templates"); }}>{counts.unbound} {counts.unbound === 1 ? "template is" : "templates are"} not ready to award →</a> : null}
      </div> : null}
      <div hidden={view !== "production"}>{production ?? <p className="text-sm text-black/55">Choose Templates to connect a product, or Shipping to manage deliveries.</p>}</div>
      <section hidden={view !== "templates"} className="scroll-mt-28 space-y-4" id="artifact-templates" aria-label="Artifact templates">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-black/55">{data.templates.length} {data.templates.length === 1 ? "template" : "templates"}</p><button id="open-new-artifact-template" className={OPERATOR_BUTTON_CLASS} onClick={() => openTask("template")} type="button">+ New template</button></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.templates.map((template) => (
            <article className="operator-bento-card min-w-0" key={template.templateId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="text-lg font-semibold leading-tight">{template.name}</h3><p className="mt-1 text-xs text-black/48">v{template.version ?? "—"} · {template.versionStatus ?? "no version"}</p></div>
                <span className={`rounded-[3px] px-2 py-1 text-xs ${template.bindingVerified && template.livemode ? "bg-[var(--color-verdigris)] text-white" : template.bindingVerified ? "bg-[var(--color-shop)] text-black" : "bg-[var(--color-poster)] text-white"}`}>{template.bindingVerified ? template.livemode ? "Live product" : "Test only" : "Product needs attention"}</span>
              </div>
              <ShopifyBindingForm livemode={template.livemode} productGid={template.productGid} productHandle={template.productHandle} templateId={template.templateId} />
            </article>
          ))}
          {!data.templates.length ? <p className="rounded-[4px] bg-black/[0.035] p-6 text-sm text-black/55">No templates yet. Create one and connect the Shopify product members will receive.</p> : null}
        </div>
      </section>
      <section hidden={view !== "shipping"} className="scroll-mt-28 space-y-4" id="artifact-fulfillment" aria-label="Artifact shipping">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-black/55">{counts.shipments} active {counts.shipments === 1 ? "shipment" : "shipments"}</p><button id="open-new-artifact-shipment" className={OPERATOR_BUTTON_CLASS} onClick={() => openTask("shipment")} type="button">+ Add tracking</button></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.shipments.map((shipment) => (
            <article className="operator-bento-card min-w-0" key={shipment.shipmentId}>
              <div className="flex flex-wrap items-start justify-between gap-2"><strong className="text-base font-semibold">{shipment.memberName}</strong><span className={`rounded-[4px] px-2 py-1 text-xs capitalize ${shipment.status === "exception" ? "bg-[var(--color-poster)] text-white" : "bg-black/[0.06] text-black/65"}`}>{shipment.status.replaceAll("_", " ")}</span></div>
              <p className="mt-2 text-xs text-black/55">{shipment.carrier}{shipment.serviceLevel ? ` · ${shipment.serviceLevel}` : ""}</p>
              <p className="mt-1 break-all text-sm">{shipment.trackingNumber}</p>
              {shipment.trackingUrl ? <a className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={shipment.trackingUrl} rel="noreferrer" target="_blank">Open tracking ↗</a> : <p className="mt-2 text-xs text-black/40">No tracking link</p>}
              <ShipmentUpdateForm shipment={shipment} />
            </article>
          ))}
          {!data.shipments.length ? <p className="rounded-[4px] bg-black/[0.035] p-6 text-sm text-black/55">No shipments recorded yet. Add tracking when an Artifact is ready to send.</p> : null}
        </div>
      </section>
      {task ? <OperatorDialog open title={task === "award" ? "Award an Artifact" : task === "template" ? "New template" : "Add tracking"} onClose={closeTask} returnFocusId={task === "award" ? "open-award-artifact" : task === "template" ? "open-new-artifact-template" : "open-new-artifact-shipment"}>
        <div id={task === "award" ? "award-artifact" : task === "template" ? "new-artifact-template" : "new-artifact-shipment"}>
          {task === "award" ? <>
            {!data.members.length ? <p className="mb-4 text-sm text-[var(--color-poster)]">Add a member before awarding an Artifact.</p> : null}
            {!data.templates.some(isLiveAwardableArtifactTemplate) ? <p className="mb-4 text-sm text-[var(--color-poster)]">Connect a live Shopify product to an active template before awarding it.</p> : null}
            <ArtifactAwardForm data={data} onSuccess={taskSucceeded} />
          </> : task === "template" ? <TemplateCreateForm onSuccess={taskSucceeded} /> : <>
            {!artifacts.some((artifact) => artifact.artifactJobId && artifact.state !== "canceled") ? <p className="mb-4 text-sm text-[var(--color-poster)]">Award an Artifact first to create its production job.</p> : null}
            <ShipmentCreateForm artifacts={artifacts} onSuccess={taskSucceeded} />
          </>}
        </div>
      </OperatorDialog> : null}
    </section>
    </ArtifactPreviewContext.Provider>
  );
}
