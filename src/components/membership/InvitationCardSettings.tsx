"use client";

import { useEffect, useState } from "react";
import { defaultMemberCardSettings, MEMBER_CARD_LIMITS, type MemberCardSettings, type MemberCardSnapshot, type PublicMemberCard } from "@/lib/membership/public-card-model";
import styles from "./MemberInvitation.module.css";

const choices = [["showBio", "Bio"], ["showLocation", "Location"], ["showMemberSince", "Member since"], ["showBuilding", "What I’m building"]] as const;

export default function InvitationCardSettings({ disabled, preview, onSaved }: {
  disabled: boolean; preview: boolean; onSaved: (card: PublicMemberCard) => void;
}) {
  const [snapshot, setSnapshot] = useState<MemberCardSnapshot | null>(null);
  const [settings, setSettings] = useState<MemberCardSettings | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    setError("");
    fetch("/api/my/card", { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.snapshot) throw new Error(result.error || "Card details could not load.");
      if (!controller.signal.aborted) { setSnapshot(result.snapshot); setSettings(result.snapshot.invitationCustomized ? result.snapshot.settings : { ...defaultMemberCardSettings(), publicEnabled: result.snapshot.settings.publicEnabled }); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Card details could not load."); });
    return () => controller.abort();
  }, [preview, retry]);
  async function save() {
    if (!snapshot || !settings || disabled || pending || preview) return;
    setPending(true); setError(""); setStatus("");
    try {
      const response = await fetch("/api/my/card", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...settings, showPortrait: false, showWebsite: false, version: snapshot.version, customizeInvitation: true }) });
      const result = await response.json();
      if (!response.ok || !result.snapshot) throw new Error(result.error || "Card details could not save.");
      setSnapshot(result.snapshot); setSettings(result.snapshot.settings); onSaved(result.snapshot.card);
      setStatus("Card details saved. Your invitations use these details.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Card details could not save."); }
    finally { setPending(false); }
  }
  return <details id="card-customization" className={styles.panel}>
    <summary>Customize your card</summary>
    <p>Your full name is included. Add only the details you want on your invitations.</p>
    {preview ? <p className={styles.note}>Cards begin with your full name. Customization is available with an active membership.</p> : settings && snapshot ? <>
      <fieldset className={styles.fields} disabled={disabled || pending || !snapshot.writable}>
        <legend className={styles.visuallyHidden}>Details on your invitation card</legend>
        {choices.map(([key, label]) => <label className={styles.emailChoice} key={key}><input type="checkbox" checked={settings[key]} onChange={event => { const checked = event.currentTarget.checked; setSettings(current => current ? { ...current, [key]: checked } : current); }} />{label}</label>)}
        {snapshot.availableLabels.length > 0 && <div><p className={styles.note}>Earned labels · up to two</p>{snapshot.availableLabels.map(label => {
          const selected = settings.labelIds.includes(label.id);
          return <label className={styles.emailChoice} key={label.id}><input type="checkbox" checked={selected} disabled={!selected && settings.labelIds.length >= MEMBER_CARD_LIMITS.labels} onChange={() => setSettings(current => current ? { ...current, labelIds: selected ? current.labelIds.filter(id => id !== label.id) : [...current.labelIds, label.id] } : current)} />{label.label}</label>;
        })}</div>}
      </fieldset>
      <button type="button" className={styles.quiet} disabled={disabled || pending || !snapshot.writable} onClick={() => void save()}>{pending ? "Saving…" : "Save card details"}</button>
    </> : !error ? <p className={styles.note}>Loading card details…</p> : null}
    {error && <div><p role="alert" className={styles.error}>{error}</p><button className={styles.quiet} type="button" onClick={() => setRetry(value => value + 1)}>Reload card details</button></div>}
    {status && <p role="status" className={styles.note}>{status}</p>}
  </details>;
}
