"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type CommunicationKind = "chat" | "meet";
type CommunicationEntityType = "circle" | "experience";

type CommunicationResponse = {
  communication?: {
    connected: boolean;
    url: string | null;
  };
  error?: unknown;
};

export default function OperatorGoogleCommunicationField({
  configured,
  editable,
  entityId,
  entityType,
  initialUrl,
  kind,
  preview = false,
}: {
  configured: boolean;
  editable: boolean;
  entityId: string;
  entityType: CommunicationEntityType;
  initialUrl: string | null;
  kind: CommunicationKind;
  preview?: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl ?? "");
  const [draft, setDraft] = useState(initialUrl ?? "");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const connected = Boolean(url);
  const name = kind === "chat" ? "Google Chat" : "Google Meet";
  const label = kind === "chat" ? "Chat space link" : "Meet room link";
  const placeholder = kind === "chat"
    ? "https://chat.google.com/room/…"
    : "https://meet.google.com/abc-defg-hij";

  async function request(method: "DELETE" | "PUT", nextUrl?: string) {
    if (preview) {
      setError(false);
      setNotice(`Preview only — the ${name} link was not changed.`);
      return;
    }
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
      const savedUrl = payload?.communication?.url ?? "";
      setUrl(savedUrl);
      setDraft(savedUrl);
      setNotice(savedUrl ? `${name} is ready.` : `${name} was disconnected.`);
      router.refresh();
    } catch (requestError) {
      setError(true);
      setNotice(
        requestError instanceof Error
          ? requestError.message
          : `The ${name} link could not be changed.`,
      );
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await request("PUT", String(form.get("url") ?? ""));
  }

  const tone = kind === "chat"
    ? "bg-[var(--color-shop)]/55"
    : "bg-[var(--color-verdigris)]/[0.12]";

  return (
    <div className={`rounded-[4px] px-4 py-3 ${tone}`} data-google-communication={kind}>
      <div className="flex items-center justify-between gap-3">
        <p className="[font-family:var(--font-cadehandy2)] text-[1.2rem] leading-none text-black/72">
          {name}
        </p>
        <p className="flex items-center gap-2 text-[0.66rem] font-medium text-black/58">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${
              !configured
                ? "bg-[var(--color-poster)]"
                : connected
                  ? "bg-[var(--color-verdigris)]"
                  : "bg-black/28"
            }`}
          />
          {!configured ? "Setup needed" : connected ? "Ready" : "Not linked"}
        </p>
      </div>

      {!configured ? (
        <p className="mt-2 text-xs leading-relaxed text-black/52">
          Choose test or live Google mode before adding links.
        </p>
      ) : editable ? (
        <details className="group mt-2">
          <summary className="w-fit cursor-pointer list-none text-xs font-medium text-black/58 underline decoration-black/25 underline-offset-4 marker:content-none hover:text-black">
            {connected ? "Change link" : "Add link"}
          </summary>
          <form className="mt-3 grid gap-3" onSubmit={submit}>
            <label htmlFor={`${kind}-${entityId}-url`}>
              <span className="[font-family:var(--font-cadehandy2)] text-[1.05rem] leading-none text-[var(--color-poster)]">
                {label}
              </span>
              <input
                className="mt-2 min-h-11 w-full rounded-[4px] border border-black/40 bg-[var(--color-bone)] px-3 py-2 text-sm normal-case tracking-normal text-black outline-none placeholder:text-black/34 focus-visible:border-black focus-visible:ring-2 focus-visible:ring-black/35 disabled:opacity-50"
                disabled={pending}
                id={`${kind}-${entityId}-url`}
                inputMode="url"
                name="url"
                placeholder={placeholder}
                required
                type="url"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className="ui-heading min-h-10 rounded-[4px] bg-black px-4 py-2 text-[0.6rem] uppercase tracking-[0.14em] text-[var(--color-bone)] hover:bg-[var(--color-poster)] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={pending}
                type="submit"
              >
                {pending ? "Saving" : connected ? "Update" : "Connect"}
              </button>
              {connected ? (
                <button
                  className="min-h-10 rounded-[4px] px-3 py-2 text-xs text-black/52 underline decoration-black/25 underline-offset-4 hover:text-[var(--color-poster)] disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={pending}
                  onClick={() => request("DELETE")}
                  type="button"
                >
                  Disconnect
                </button>
              ) : null}
            </div>
          </form>
        </details>
      ) : null}

      <p
        aria-live="polite"
        className={`mt-2 min-h-4 text-xs leading-relaxed ${error ? "text-[var(--color-poster)]" : "text-black/48"}`}
        role={error ? "alert" : "status"}
      >
        {notice ?? " "}
      </p>
    </div>
  );
}
