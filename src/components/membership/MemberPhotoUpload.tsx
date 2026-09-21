"use client";

import Image from "next/image";
import { type ChangeEvent, type PointerEvent, useEffect, useId, useRef, useState } from "react";

import { DEFAULT_MEMBER_PHOTO_CROP, MEMBER_PHOTO_SOURCE_ACCEPT, decodeMemberPhoto, exportMemberPhotoCrop, memberPhotoCropRect, panMemberPhotoCrop, validateMemberPhotoSelection, type MemberPhotoCrop } from "@/lib/membership/member-photo-crop";
import { useMemberPortrait } from "@/components/membership/MemberPortraitState";
import styles from "./MemberPhotoUpload.module.css";

type PhotoDraft = { url: string; image: HTMLImageElement | null; scope: symbol };

export default function MemberPhotoUpload({ avatarUrl: initialAvatarUrl, enabled, available = true, onChange, onBusyChange, onDraftChange }: {
  avatarUrl: string | null;
  enabled: boolean;
  available?: boolean;
  onChange: (url: string | null) => void;
  onBusyChange?: (busy: boolean) => void;
  onDraftChange?: (draft: boolean) => void;
}) {
  const { avatarUrl, setAvatarUrl, ownerId } = useMemberPortrait(initialAvatarUrl);
  const ownerScope = useRef({ ownerId, token: Symbol("photo-owner") });
  if (ownerScope.current.ownerId !== ownerId) ownerScope.current = { ownerId, token: Symbol("photo-owner") };
  const scope = ownerScope.current.token;
  const previousScope = useRef(scope);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const localUrl = useRef<string | null>(null);
  const decoding = useRef<AbortController | null>(null);
  const request = useRef<AbortController | null>(null);
  const callbacks = useRef({ onChange, onBusyChange, onDraftChange });
  callbacks.current = { onChange, onBusyChange, onDraftChange };
  const drag = useRef<{ pointerId: number; x: number; y: number; width: number; crop: MemberPhotoCrop } | null>(null);
  const [draft, setDraft] = useState<PhotoDraft | null>(null);
  const [crop, setCrop] = useState<MemberPhotoCrop>(DEFAULT_MEMBER_PHOTO_CROP);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function releaseDraft() {
    generation.current++;
    decoding.current?.abort();
    decoding.current = null;
    if (localUrl.current) URL.revokeObjectURL(localUrl.current);
    localUrl.current = null;
    drag.current = null;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      releaseDraft();
      request.current?.abort();
      callbacks.current.onBusyChange?.(false);
      callbacks.current.onDraftChange?.(false);
    };
  }, []);
  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    releaseDraft(); request.current?.abort(); request.current = null;
    inFlight.current = false;
    setDraft(null); setPending(false); setError(null); setMessage(null);
    callbacks.current.onBusyChange?.(false); callbacks.current.onDraftChange?.(false);
  }, [scope]);
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !enabled || !available || inFlight.current) return;
    setError(null); setMessage(null);
    try { validateMemberPhotoSelection(file); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Choose a JPG, PNG, WebP, or HEIC photo."); return; }
    releaseDraft();
    const current = generation.current;
    const controller = new AbortController();
    decoding.current = controller;
    try {
      const url = URL.createObjectURL(file);
      localUrl.current = url;
      setCrop(DEFAULT_MEMBER_PHOTO_CROP);
      setDraft({ url, image: null, scope });
      callbacks.current.onDraftChange?.(true);
      const image = await decodeMemberPhoto(url, controller.signal);
      if (!mounted.current || current !== generation.current || ownerScope.current.token !== scope) return;
      setDraft({ url, image, scope });
      decoding.current = null;
    } catch (cause) {
      if (!mounted.current || current !== generation.current || ownerScope.current.token !== scope) return;
      releaseDraft(); setDraft(null); callbacks.current.onDraftChange?.(false);
      setError(cause instanceof Error ? cause.message : "That photo could not be opened. Choose another photo.");
    }
  }

  function cancelDraft() {
    if (inFlight.current) return;
    releaseDraft(); setDraft(null); setError(null); setMessage(null);
    callbacks.current.onDraftChange?.(false);
  }

  async function savePhoto(remove = false) {
    if (!enabled || !available || inFlight.current || (!remove && (!draft?.image || draft.scope !== scope))) return;
    inFlight.current = true;
    setPending(true); setError(null); setMessage(null);
    callbacks.current.onBusyChange?.(true);
    const current = generation.current;
    const owner = ownerId;
    const publishPortrait = setAvatarUrl;
    const controller = new AbortController();
    request.current = controller;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const photo = remove ? null : await exportMemberPhotoCrop(draft!.image!, crop);
      if (!mounted.current || current !== generation.current || ownerScope.current.token !== scope) return;
      const form = new FormData();
      if (photo) form.append("photo", photo);
      timeout = setTimeout(() => controller.abort(), 45_000);
      const response = await fetch("/api/my/profile/photo", {
        method: remove ? "DELETE" : "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        ...(owner ? { headers: { "X-Ruined-Session-Owner": owner } } : {}),
        ...(photo ? { body: form } : {}),
      });
      const result = await response.json() as { avatarUrl?: string | null; error?: string };
      if (!mounted.current || current !== generation.current || ownerScope.current.token !== scope) return;
      if (!response.ok || (remove ? result.avatarUrl !== null : typeof result.avatarUrl !== "string" || !result.avatarUrl.startsWith("/api/member-photos/"))) {
        throw new Error(result.error || "Your photo could not be saved. Try again.");
      }
      publishPortrait(result.avatarUrl ?? null);
      callbacks.current.onChange(result.avatarUrl ?? null);
      releaseDraft(); setDraft(null); callbacks.current.onDraftChange?.(false);
      setMessage(remove ? "Photo removed." : "Photo saved.");
    } catch (cause) {
      if (!mounted.current || current !== generation.current || ownerScope.current.token !== scope) return;
      setError(controller.signal.aborted ? remove ? "Removing your photo took too long. Try again." : "Saving took too long. Your crop is still here; try again." : cause instanceof Error ? cause.message : "Your photo could not be saved. Try again.");
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        inFlight.current = false;
        if (mounted.current) { setPending(false); callbacks.current.onBusyChange?.(false); }
      }
    }
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!draft?.image || pending || !enabled || event.button !== 0) return;
    const width = event.currentTarget.getBoundingClientRect().width;
    if (!width) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width, crop };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId || !draft?.image || pending) return;
    setCrop(panMemberPhotoCrop(draft.image.naturalWidth, draft.image.naturalHeight, start.crop, (event.clientX - start.x) / start.width, (event.clientY - start.y) / start.width));
  }

  const rect = draft?.image ? memberPhotoCropRect(draft.image.naturalWidth, draft.image.naturalHeight, crop) : null;
  const disabled = !enabled || !available || pending;
  return (
    <div className={styles.upload} aria-busy={pending || Boolean(draft && !draft.image)}>
      <div className={`${styles.preview} aspect-square ${draft ? styles.cropping : ""}`} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        {draft ? <Image alt="Unsaved profile photo crop" src={draft.url} unoptimized draggable={false} width={draft.image?.naturalWidth ?? 1024} height={draft.image?.naturalHeight ?? 1024} className={styles.cropImage} style={rect && draft.image ? { width: `${draft.image.naturalWidth / rect.side * 100}%`, height: `${draft.image.naturalHeight / rect.side * 100}%`, left: `${-rect.x / rect.side * 100}%`, top: `${-rect.y / rect.side * 100}%` } : { width: "100%", height: "100%", objectFit: "cover" }} /> : avatarUrl ? (
          <Image alt="Your profile photo" className={styles.savedImage} fill sizes="256px" src={avatarUrl} unoptimized />
        ) : (
          <div className={styles.placeholder}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="12" cy="8" r="4" /><path d="M4 22v-2a8 8 0 0 1 16 0v2" /></svg></div>
        )}
        {pending || (draft && !draft.image) ? <div className={styles.progress} role="status">{pending ? "Saving photo…" : "Opening photo…"}</div> : null}
      </div>
      {draft ? <div className={styles.editor}>
        <p className={styles.hint}>Drag to position, or use the controls below. This photo is not saved yet.</p>
        <label className={styles.control} htmlFor={`${inputId}-zoom`}>Zoom <input id={`${inputId}-zoom`} type="range" min="1" max="3" step="0.01" value={crop.zoom} aria-valuetext={`${Math.round(crop.zoom * 100)} percent`} disabled={disabled || !draft.image} onChange={event => setCrop(current => ({ ...current, zoom: Number(event.currentTarget.value) }))} /></label>
        <label className={styles.control} htmlFor={`${inputId}-horizontal`}>Horizontal position <input id={`${inputId}-horizontal`} type="range" min="-1" max="1" step="0.01" value={crop.x} disabled={disabled || !rect || draft.image?.naturalWidth === rect.side} onChange={event => setCrop(current => ({ ...current, x: Number(event.currentTarget.value) }))} /></label>
        <label className={styles.control} htmlFor={`${inputId}-vertical`}>Vertical position <input id={`${inputId}-vertical`} type="range" min="-1" max="1" step="0.01" value={crop.y} disabled={disabled || !rect || draft.image?.naturalHeight === rect.side} onChange={event => setCrop(current => ({ ...current, y: Number(event.currentTarget.value) }))} /></label>
        <div className={styles.actions}>
          <button className={styles.usePhoto} disabled={disabled || !draft.image} onClick={() => savePhoto()} type="button">{pending ? "Saving…" : "Use photo"}</button>
          <button disabled={pending} onClick={cancelDraft} type="button">Cancel</button>
          <button disabled={disabled || !draft.image} onClick={() => setCrop(DEFAULT_MEMBER_PHOTO_CROP)} type="button">Reset crop</button>
        </div>
      </div> : null}
      <input accept={MEMBER_PHOTO_SOURCE_ACCEPT} aria-label="Choose profile photo" aria-describedby={`${inputId}-help`} className="sr-only" disabled={disabled} id={inputId} onChange={selectPhoto} ref={inputRef} tabIndex={-1} type="file" />
      <div className={styles.actions}>
        <button disabled={disabled} onClick={() => inputRef.current?.click()} type="button">{draft ? "Choose another photo" : avatarUrl ? "Change photo" : "Choose photo"}</button>
        {avatarUrl && !draft ? <button disabled={disabled} onClick={() => savePhoto(true)} type="button">Remove photo</button> : null}
      </div>
      <p className={styles.hint} id={`${inputId}-help`}>JPG, PNG, WebP, or HEIC · Up to 20 MB.<br />HEIC requires a supported browser. Your profile-sharing settings apply.</p>
      {!available ? <p className={styles.hint}>{enabled ? "Photo upload is temporarily unavailable. You can save your details without a photo." : "Photo upload is unavailable in this view."}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.message} role="status">{message}</p> : null}
    </div>
  );
}
