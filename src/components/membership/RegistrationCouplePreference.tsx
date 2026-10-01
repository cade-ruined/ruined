"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Couple = { status: "none" | "pending" | "paired"; partnerEmail: string | null };
const empty: Couple = { status: "none", partnerEmail: null };
const endpoint = "/api/my/registration/couple";

async function readResponse(response: Response): Promise<Couple> {
  const payload = await response.json().catch(() => null);
  const couple = payload?.couple;
  if (!response.ok || !couple || !["none", "pending", "paired"].includes(couple.status)
    || (couple.partnerEmail !== null && typeof couple.partnerEmail !== "string")) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "Your Circle preference could not be saved. Please try again.");
  }
  return couple;
}

export function useRegistrationCouple({ enabled, preview = false }: { enabled: boolean; preview?: boolean }) {
  const [saved, setSaved] = useState<Couple>(empty);
  const [kind, setKind] = useState<"individual" | "couple">("individual");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(enabled && !preview);
  const [loadError, setLoadError] = useState<string | null>(null);
  const request = useRef(0);

  const apply = useCallback((couple: Couple) => {
    setSaved(couple);
    setKind(couple.status === "none" ? "individual" : "couple");
    setPartnerEmail(couple.partnerEmail ?? "");
    setConsent(couple.status !== "none");
  }, []);

  const reload = useCallback(async () => {
    const current = ++request.current;
    if (!enabled || preview) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    try {
      const couple = await readResponse(await fetch(endpoint, { cache: "no-store" }));
      if (current === request.current) apply(couple);
    } catch {
      if (current === request.current) setLoadError("We couldn’t load your Circle preference. Please retry before continuing.");
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [apply, enabled, preview]);

  const cancelLoad = useCallback(() => { request.current++; }, []);
  useEffect(() => { void reload(); return cancelLoad; }, [reload, cancelLoad]);

  async function save() {
    if (!enabled) return;
    if (preview) throw new Error("Preview only. No Circle preference has been saved.");
    if (loading || loadError) throw new Error("Please load your Circle preference before continuing.");
    if (saved.status === "paired") return;
    const email = partnerEmail.trim().toLowerCase();
    if (kind === "couple" && (!email || !consent)) throw new Error("Enter your partner’s email and confirm that you’re registering together.");
    if (kind === "individual" && saved.status === "none") return;
    if (kind === "couple" && saved.status === "pending" && email === saved.partnerEmail) return;
    const response = await fetch(endpoint, kind === "individual" ? { method: "DELETE" } : {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partnerEmail: email, consent: true }),
    });
    apply(await readResponse(response));
  }

  return { saved, kind, setKind, partnerEmail, setPartnerEmail, consent, setConsent, loading, loadError, reload, save };
}

type Preference = ReturnType<typeof useRegistrationCouple>;

export function RegistrationCoupleFields({ preference, disabled = false }: { preference: Preference; disabled?: boolean }) {
  const { saved, kind, setKind, partnerEmail, setPartnerEmail, consent, setConsent, loading, loadError, reload } = preference;
  if (loading) return <p className="text-sm" role="status">Loading your Circle preference…</p>;
  if (loadError) return <div className="grid gap-2 text-sm" role="alert"><p>{loadError}</p><button className="min-h-11 w-fit underline underline-offset-4" type="button" onClick={() => void reload()}>Retry loading preference</button></div>;
  if (saved.status === "paired") return <div className="grid gap-2 text-sm leading-relaxed"><p className="font-semibold">You’re registering together.</p><p className="break-words">Your Circle pairing with {saved.partnerEmail} is confirmed. You’ll be placed in the same Circle.</p><a className="min-h-11 w-fit content-center underline underline-offset-4" href="mailto:connect@theruinedproject.com">Contact Ruined to change your pairing</a></div>;
  return <fieldset className="grid min-w-0 gap-4" disabled={disabled}>
    <legend className="mb-3 font-semibold">Who’s joining?</legend>
    <div className="grid gap-2 sm:grid-cols-2">
      {([['individual', 'Just me'], ['couple', 'With my partner']] as const).map(([value, label]) => <label key={value} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded border px-3 py-3 text-sm ${kind === value ? "border-current" : "border-[var(--member-rule)]"}`}><input type="radio" name="registration-party" value={value} checked={kind === value} onChange={() => setKind(value)} className="size-4 accent-current" />{label}</label>)}
    </div>
    {kind === "couple" ? <>
      <label className="grid gap-2 text-sm">Your partner’s email<input autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} type="email" name="registration-partner-email" required maxLength={254} value={partnerEmail} onChange={event => { setPartnerEmail(event.target.value); setConsent(false); }} className="min-h-12 w-full min-w-0 rounded border border-[var(--member-rule)] bg-transparent px-3 text-inherit outline-none focus:border-current" /></label>
      <p className="text-sm leading-relaxed text-[var(--member-muted)]">Each person registers with their own email. Your partner confirms by entering your email. Once you both confirm, you’ll be placed in the same Circle.</p>
      <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1 size-4 shrink-0 accent-current" /><span>We’re registering together and want to be placed in the same Circle.</span></label>
      {saved.status === "pending" ? <p className="text-sm" role="status">Your preference is saved. Pairing is awaiting mutual confirmation.</p> : null}
      <p className="text-xs leading-relaxed text-[var(--member-muted)]">This is for Circle placement. It doesn’t start a shared subscription or authorize payment.</p>
    </> : null}
  </fieldset>;
}

export default function RegistrationCouplePreference({ preview = false }: { preview?: boolean }) {
  const preference = useRegistrationCouple({ enabled: true, preview });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || pending) return;
    setPending(true); setMessage("");
    try { await preference.save(); setMessage("Your Circle preference is saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save. Please try again."); }
    finally { setPending(false); }
  }
  return <details className="mt-8 border-y border-[var(--member-rule)] py-4">
    <summary className="cursor-pointer py-2 font-semibold">Registering with your partner?</summary>
    <form className="mt-4 grid gap-4" onSubmit={submit}>
      <RegistrationCoupleFields preference={preference} disabled={pending || preview} />
      {preference.saved.status !== "paired" ? <button type="submit" disabled={preview || pending || preference.loading || Boolean(preference.loadError)} className="min-h-12 w-fit rounded border border-current px-5 text-sm font-semibold disabled:opacity-45">{pending ? "Saving…" : "Save Circle preference"}</button> : null}
      {message ? <p className="text-sm" role="status">{message}</p> : null}
    </form>
  </details>;
}
