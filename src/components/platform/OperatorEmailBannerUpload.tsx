"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { ResendEmailBanner } from "@/lib/communications/resend-email-model";
import { insertResendEmailBanner, normalizeResendEmailBanner } from "@/lib/communications/resend-email-templates";

export type LocalEmailBanner = { dataUrl: string; filename: string; width: number; height: number };
const MAX_BYTES = 3 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-none border border-black/25 px-4 py-2 text-sm font-medium hover:bg-[var(--operator-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-40";

function aborted() { return new DOMException("Photo selection cancelled", "AbortError"); }

async function decodePhoto(file: File, signal: AbortSignal): Promise<LocalEmailBanner> {
  if (!file.size || file.size > MAX_BYTES) throw new Error("Choose a JPG, PNG, or WebP photo up to 3 MB.");
  if (file.type && !ACCEPTED_TYPES.includes(file.type.toLowerCase())) throw new Error("Choose a JPG, PNG, or WebP photo.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
    : [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte) ? "image/png"
      : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" ? "image/webp" : "";
  if (!mime || (file.type && file.type.toLowerCase() !== mime)) throw new Error("This file is not a valid JPG, PNG, or WebP photo. Choose another image.");
  if (signal.aborted) throw aborted();
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new window.Image();
      function cleanup() { candidate.onload = null; candidate.onerror = null; signal.removeEventListener("abort", cancel); }
      function cancel() { cleanup(); candidate.src = ""; reject(aborted()); }
      candidate.onload = () => { cleanup(); resolve(candidate); };
      candidate.onerror = () => { cleanup(); reject(new Error("That photo could not be opened. Choose another image.")); };
      signal.addEventListener("abort", cancel, { once: true });
      candidate.src = objectUrl;
    });
    if (signal.aborted) throw aborted();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("Choose a photo smaller than 40 megapixels.");
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The photo could not be prepared in this browser.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Rasterize first: local previews never embed arbitrary uploaded bytes or metadata.
    const dataUrl = canvas.toDataURL(mime, 0.9);
    if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)) throw new Error("The photo could not be prepared in this browser.");
    return { dataUrl, filename: file.name, width: canvas.width, height: canvas.height };
  } finally { URL.revokeObjectURL(objectUrl); }
}

/** Client preview only. This HTML and its temporary data URL must never enter a send payload. */
export function renderLocalEmailBanner(html: string, local: LocalEmailBanner, details?: Partial<ResendEmailBanner> | null): string {
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(local.dataUrl)) throw new Error("Choose the local photo again.");
  const placeholder = `https://banner-preview.example.com/${crypto.randomUUID()}.png`;
  const alt = details?.alt?.trim() || "Banner preview";
  let banner: ResendEmailBanner = { url: placeholder, alt };
  try { normalizeResendEmailBanner(banner); }
  catch { banner = { url: placeholder, alt: "Banner preview" }; }
  if (details?.linkUrl) {
    try { banner = normalizeResendEmailBanner({ ...banner, linkUrl: details.linkUrl })!; }
    catch { /* Incomplete destinations do not interrupt the local image preview. */ }
  }
  const rendered = insertResendEmailBanner(html, banner);
  return rendered.replace(`src="${placeholder}"`, `src="${local.dataUrl}"`);
}

export default function OperatorEmailBannerUpload({
  preview, disabled, local, onBegin, onFinish, onHosted, onLocal, onCancelLocal,
}: {
  preview: boolean;
  disabled: boolean;
  local: LocalEmailBanner | null;
  onBegin: () => boolean;
  onFinish: () => void;
  onHosted: (url: string) => void;
  onLocal: (photo: LocalEmailBanner) => void;
  onCancelLocal: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const callbacks = useRef({ onFinish, onHosted, onLocal });
  callbacks.current = { onFinish, onHosted, onLocal };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || disabled || requestRef.current || !onBegin()) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true); setError(""); setNotice("");
    const timeout = window.setTimeout(() => controller.abort("timeout"), 45_000);
    try {
      const photo = await decodePhoto(file, controller.signal);
      if (controller.signal.aborted || !mounted.current || requestRef.current !== controller) return;
      if (preview) {
        callbacks.current.onLocal(photo);
      } else {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/ops/emails/resend/banner-upload", { method: "POST", body: form, cache: "no-store", credentials: "same-origin", signal: controller.signal });
        const result = await response.json().catch(() => null) as { image?: { url?: string }; error?: string } | null;
        if (controller.signal.aborted || !mounted.current || requestRef.current !== controller) return;
        if (!response.ok || typeof result?.image?.url !== "string") throw new Error(result?.error || "The photo could not be uploaded. Try again.");
        const banner = normalizeResendEmailBanner({ url: result.image.url, alt: "Banner preview" });
        if (!banner) throw new Error("The image host did not return a usable URL. Try again.");
        callbacks.current.onHosted(banner.url);
        setNotice("Photo uploaded. Check its description before sending.");
      }
    } catch (failure) {
      if (!mounted.current || requestRef.current !== controller) return;
      if (controller.signal.aborted) {
        if (controller.signal.reason === "timeout") setError("The photo took too long to upload. Your previous banner is unchanged. Try again.");
        else setNotice("Photo selection cancelled. Your previous banner is unchanged.");
      } else setError(failure instanceof Error ? failure.message : "The photo could not be uploaded. Your previous banner is unchanged.");
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (mounted.current) { setPending(false); callbacks.current.onFinish(); }
      }
    }
  }

  return <div className="space-y-2" aria-busy={pending}>
    <input accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label="Choose banner photo from device" className="sr-only" disabled={disabled || pending} id="resend-banner-file" onChange={(event) => void selectPhoto(event)} ref={inputRef} tabIndex={-1} type="file" />
    <div className="flex flex-wrap items-center gap-3"><button className={BUTTON} disabled={disabled || pending} id="resend-upload-banner" onClick={() => inputRef.current?.click()} type="button">{pending ? preview ? "Preparing photo…" : "Uploading photo…" : local ? "Choose another photo" : "Upload photo"}</button>{pending ? <button className="min-h-11 text-sm underline underline-offset-4" id="resend-cancel-banner-upload" onClick={() => requestRef.current?.abort("cancelled")} type="button">Cancel upload</button> : null}{local && !pending ? <button className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-40" disabled={disabled} id="resend-clear-local-banner" onClick={() => { onCancelLocal(); setError(""); setNotice(""); }} type="button">Use previous image</button> : null}</div>
    <p className="text-xs leading-relaxed text-black/70">JPG, PNG, or WebP · Up to 3 MB.{preview ? " Files stay on this device in preview." : " Uploaded images are hosted publicly for email recipients."}</p>
    {local ? <p className="break-words text-xs leading-relaxed text-black/65" id="resend-local-banner-notice" role="status"><strong>Local preview — not uploaded.</strong> {local.filename}</p> : null}
    {error ? <p className="text-sm leading-relaxed text-[var(--operator-danger)]" role="alert">{error}</p> : null}
    {notice ? <p className="text-xs leading-relaxed text-black/70" role="status">{notice}</p> : null}
  </div>;
}
