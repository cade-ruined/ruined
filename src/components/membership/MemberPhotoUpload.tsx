"use client";

import Image from "next/image";
import { type ChangeEvent, useId, useRef, useState } from "react";

import { MEMBER_PHOTO_ACCEPT, MEMBER_PHOTO_MAX_BYTES } from "@/lib/membership/photo-policy";

export default function MemberPhotoUpload({
  avatarUrl,
  enabled,
  available = true,
  onChange,
  onBusyChange,
}: {
  avatarUrl: string | null;
  enabled: boolean;
  available?: boolean;
  onChange: (url: string | null) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changePhoto(file?: File) {
    if (!enabled || !available || inFlight.current) return;
    setError(null);
    setMessage(null);
    if (file && (!MEMBER_PHOTO_ACCEPT.split(",").includes(file.type) || file.size === 0 || file.size > MEMBER_PHOTO_MAX_BYTES)) {
      setError("Choose a JPG, PNG, or WebP photo under 3 MB.");
      return;
    }
    inFlight.current = true;
    setPending(true);
    onBusyChange?.(true);
    try {
      const form = new FormData();
      if (file) form.append("photo", file);
      const response = await fetch("/api/my/profile/photo", {
        method: file ? "POST" : "DELETE",
        ...(file ? { body: form } : {}),
      });
      const result = await response.json() as { avatarUrl?: string | null; error?: string };
      if (!response.ok || result.avatarUrl === undefined) {
        throw new Error(result.error || "Your photo could not be saved. Try again.");
      }
      onChange(result.avatarUrl);
      setMessage(file ? "Photo saved." : "Photo removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your photo could not be saved. Try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
      onBusyChange?.(false);
    }
  }

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void changePhoto(file);
  }

  return (
    <div className="w-full max-w-64" aria-busy={pending}>
      <div className="relative mt-3 aspect-square overflow-hidden rounded-[4px] bg-current/[0.04]">
        {avatarUrl ? (
          <Image alt="Your profile photo" className="object-cover" fill sizes="256px" src={avatarUrl} unoptimized />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-[4px] border border-dashed border-current/25 p-5 text-center">
            <svg aria-hidden="true" className="size-10 opacity-45" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 22v-2a8 8 0 0 1 16 0v2" />
            </svg>
          </div>
        )}
        {pending ? <div className="absolute inset-0 grid place-items-center bg-black/55 text-sm text-white" role="status">Saving photo…</div> : null}
      </div>
      <input
        accept={MEMBER_PHOTO_ACCEPT}
        aria-label="Choose profile photo"
        aria-describedby={`${inputId}-help`}
        className="sr-only"
        disabled={!enabled || !available || pending}
        id={inputId}
        onChange={selectPhoto}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-5">
        <button className="min-h-11 text-sm font-medium underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-40" disabled={!enabled || !available || pending} onClick={() => inputRef.current?.click()} type="button">
          {avatarUrl ? "Change photo" : "Choose photo"}
        </button>
        {avatarUrl ? <button className="min-h-11 text-sm opacity-65 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-40" disabled={!enabled || !available || pending} onClick={() => void changePhoto()} type="button">Remove photo</button> : null}
      </div>
      <p className="text-xs leading-relaxed opacity-60" id={`${inputId}-help`}>JPG, PNG, or WebP · Up to 3 MB.<br />Your profile-sharing settings apply.</p>
      {!available ? <p className="mt-2 text-xs leading-relaxed opacity-60">Photo upload is temporarily unavailable. You can save your details without a photo.</p> : null}
      {error ? <p className="mt-2 text-sm text-[var(--color-poster)]" role="alert">{error}</p> : null}
      {message ? <p className="mt-2 text-sm" role="status">{message}</p> : null}
    </div>
  );
}
