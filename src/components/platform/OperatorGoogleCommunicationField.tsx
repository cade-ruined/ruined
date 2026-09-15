"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS, OPERATOR_LABEL_TEXT_CLASS } from "@/components/platform/operatorStyles";

type CommunicationKind = "chat" | "meet";
type CommunicationEntityType = "circle" | "experience";

type CommunicationResponse = {
  communication?: {
    connected: boolean;
    entityId: string;
    entityType: CommunicationEntityType;
    kind: CommunicationKind;
    url: string | null;
  };
  error?: unknown;
};

type CommunicationFieldProps = {
  configured: boolean;
  editable: boolean;
  entityId: string;
  entityType: CommunicationEntityType;
  initialUrl: string | null;
  kind: CommunicationKind;
  inline?: boolean;
  preview?: boolean;
};

export default function OperatorGoogleCommunicationField(props: CommunicationFieldProps) {
  // A new target or authoritative saved URL must never inherit another form's
  // unsaved draft, confirmation, or pending request state.
  const editorKey = JSON.stringify([props.entityType, props.entityId, props.kind, props.initialUrl, props.configured, props.editable, props.preview]);
  return <GoogleCommunicationEditor key={editorKey} {...props} />;
}

function GoogleCommunicationEditor({ configured, editable, entityId, entityType, initialUrl, kind, preview = false }: CommunicationFieldProps) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl ?? "");
  const [draft, setDraft] = useState(initialUrl ?? "");
  const [editing, setEditing] = useState(!initialUrl);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [copying, setCopying] = useState(false);
  const requestInFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const connected = Boolean(url);
  const name = kind === "chat" ? "Google Chat" : "Google Meet";
  const linkName = kind === "chat" ? "chat link" : "meeting link";
  const label = kind === "chat" ? "Chat link" : "Meeting link";
  const placeholder = kind === "chat"
    ? "https://chat.google.com/room/…"
    : "https://meet.google.com/abc-defg-hij";

  async function request(method: "DELETE" | "PUT", nextUrl?: string) {
    if (!configured || !editable || requestInFlight.current || !mounted.current) return;
    if (method === "DELETE" && (!confirmRemoval || !url)) return;
    if (preview) {
      setError(false);
      setNotice(`Preview only — the ${name} link was not changed.`);
      return;
    }
    if (method === "PUT" && !nextUrl?.trim()) {
      setError(true);
      setNotice(`Paste the ${linkName} first.`);
      return;
    }
    requestInFlight.current = true;
    setPending(true);
    setNotice(null);
    setError(false);
    try {
      const response = await fetch("/api/ops/google-communications", {
        body: JSON.stringify({
          entityId,
          entityType,
          ...(method === "PUT" ? { url: nextUrl ?? "" } : {}),
        }),
        headers: { "Content-Type": "application/json" },
        method,
      });
      const payload = (await response.json().catch(() => null)) as CommunicationResponse | null;
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : `The ${name} link could not be changed.`,
        );
      }
      const saved = payload?.communication;
      if (!saved || saved.entityId !== entityId || saved.entityType !== entityType || saved.kind !== kind
        || (method === "PUT" ? saved.connected !== true || typeof saved.url !== "string" || !saved.url : saved.connected !== false || saved.url !== null)) {
        throw new Error("The saved link could not be verified. Refresh before trying again.");
      }
      if (!mounted.current) return;
      const savedUrl = saved.url ?? "";
      setUrl(savedUrl);
      setDraft(savedUrl);
      setEditing(!savedUrl);
      setConfirmRemoval(false);
      setNotice(savedUrl ? `${kind === "chat" ? "Chat" : "Meeting"} link saved in Ruined. No invitation was sent.` : "Link removed from Ruined. Nothing was changed in Google.");
      router.refresh();
    } catch (requestError) {
      if (!mounted.current) return;
      setError(true);
      setNotice(
        requestError instanceof Error
          ? requestError.message
          : `The ${name} link could not be changed.`,
      );
    } finally {
      requestInFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await request("PUT", draft.trim());
  }

  async function copyLink() {
    if (!configured || !url || copying || !mounted.current) return;
    setCopying(true);
    setError(false);
    try {
      await navigator.clipboard.writeText(url);
      if (mounted.current) setNotice(`${kind === "chat" ? "Chat" : "Meeting"} link copied.`);
    } catch {
      if (mounted.current) {
        setError(true);
        setNotice("The link could not be copied. Select and copy the saved URL.");
      }
    } finally {
      if (mounted.current) setCopying(false);
    }
  }

  const tone = kind === "chat"
    ? "bg-[var(--color-shop)]/55"
    : "bg-[var(--color-verdigris)]/[0.12]";

  return (
    <div
      className={`rounded-[4px] px-4 py-3 ${tone}`}
      data-google-communication={kind}
      data-operator-dirty={editing && (draft !== url || confirmRemoval) ? "true" : undefined}
      data-operator-pending={pending ? "true" : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="[font-family:var(--font-cadehandy2)] text-[1.2rem] leading-none text-black/72">
          {name}
        </p>
        {!configured || !connected ? <p className="flex items-center gap-2 text-[0.66rem] font-medium text-black/58">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${
              !configured
                ? "bg-[var(--color-poster)]"
                : "bg-black/28"
            }`}
          />
          {!configured ? "Setup needed" : "Not linked"}
        </p> : null}
      </div>

      {configured && connected ? <div className="mt-2">
        <a className="block break-all text-sm text-black/65 underline decoration-black/25 underline-offset-4" href={url} rel="noreferrer" target="_blank">{url}</a>
        <div className="flex flex-wrap items-center gap-2">
          <a className="inline-flex min-h-11 items-center px-2 text-sm font-semibold underline underline-offset-4" href={url} rel="noreferrer" target="_blank">{kind === "chat" ? "Open chat ↗" : "Open meeting ↗"}</a>
          <button className="min-h-11 px-2 text-sm underline underline-offset-4 disabled:opacity-45" disabled={copying} onClick={copyLink} type="button">{copying ? "Copying…" : "Copy link"}</button>
          {editable && !editing ? <button
            aria-label={`Edit ${linkName}`}
            className="min-h-11 px-2 text-sm underline underline-offset-4"
            onClick={() => { setDraft(url); setNotice(null); setError(false); setConfirmRemoval(false); setEditing(true); }}
            type="button"
          >Edit</button> : null}
        </div>
      </div> : null}

      {!configured ? (
        <p className="mt-2 text-xs leading-relaxed text-black/52">
          Choose test or live Google mode before adding links.
        </p>
      ) : editable && editing ? (
        <div className="mt-2">
          <p className="text-sm leading-relaxed text-black/60">
            {kind === "chat"
              ? "Create a private space in Google Chat, add its members there, then paste its link here. Saving a link does not grant Google access."
              : "Paste an existing Google Meet link here. Saving it does not send invitations or change Google access; use Calendar invitations for that flow."}
          </p>
          <form className="mt-3 grid gap-3" onSubmit={submit}>
            <label htmlFor={`${kind}-${entityId}-url`}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>
                {label}
              </span>
              <input
                className={OPERATOR_FIELD_CLASS}
                disabled={pending}
                id={`${kind}-${entityId}-url`}
                inputMode="url"
                name="url"
                placeholder={placeholder}
                required
                type="url"
                value={draft}
                onChange={(event) => { setDraft(event.target.value); setConfirmRemoval(false); }}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className={OPERATOR_BUTTON_CLASS}
                disabled={pending}
                type="submit"
              >
                {pending ? "Saving…" : kind === "chat" ? connected ? "Save chat link" : "Set chat link" : "Save meeting link"}
              </button>
              {connected ? <button
                className="min-h-11 px-3 text-sm underline underline-offset-4 disabled:opacity-45"
                disabled={pending}
                onClick={() => {
                  if (requestInFlight.current) return;
                  setDraft(url);
                  setConfirmRemoval(false);
                  setNotice(null);
                  setError(false);
                  setEditing(false);
                }}
                type="button"
              >Cancel</button> : null}
              {connected ? (
                <button
                  className="min-h-10 rounded-[4px] px-3 py-2 text-xs text-black/52 underline decoration-black/25 underline-offset-4 hover:text-[var(--color-poster)] disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={pending}
                  onClick={() => { if (!pending) setConfirmRemoval(true); }}
                  type="button"
                >
                  Remove link
                </button>
              ) : null}
            </div>
          </form>
          {confirmRemoval ? <div className="mt-3 rounded-[4px] bg-[var(--color-bone)]/70 p-3" role="group" aria-label={`Confirm ${linkName} removal`}>
            <p className="text-sm leading-relaxed">Remove this {linkName} from Ruined? {kind === "chat" ? "The Google Chat space and its members stay unchanged. Manage membership in Google Chat." : "The Google meeting stays unchanged. This does not cancel it or send cancellation notices."}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={OPERATOR_BUTTON_CLASS} disabled={pending} onClick={() => request("DELETE")} type="button">Confirm remove link</button>
              <button className="min-h-11 px-3 text-sm underline underline-offset-4" disabled={pending} onClick={() => setConfirmRemoval(false)} type="button">Keep link</button>
            </div>
          </div> : null}
        </div>
      ) : null}

      <p
        aria-live="polite"
        className={`${notice ? "mt-2" : ""} text-xs leading-relaxed ${error ? "text-[var(--color-poster)]" : "text-black/48"}`}
        role={error ? "alert" : "status"}
      >
        {notice}
      </p>
    </div>
  );
}
