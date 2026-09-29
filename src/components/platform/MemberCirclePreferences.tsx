"use client";
import { useEffect, useState, type FormEvent } from "react";
import { CIRCLE_DAYS, CIRCLE_PERIODS, type CirclePreferencesView } from "@/lib/platform/circle-placement-model";

export default function MemberCirclePreferences({ preview = false }: { preview?: boolean }) {
  const [data, setData] = useState<CirclePreferencesView | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    if (preview) { setData({ preferences: { timezone: "America/Denver", availability: ["2:evening", "4:evening"], preferredConnectionId: null }, connections: [] }); return; }
    fetch("/api/my/circle-preferences", { cache: "no-store" }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Preferences are unavailable.");
      if (active) setData({ ...result, preferences: { ...result.preferences, timezone: result.preferences.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone } });
    }).catch(error => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, [preview]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!data) return;
    if (preview) { setNotice("Preview only. No preferences were saved."); return; }
    setSaving(true); setNotice("");
    try { const response = await fetch("/api/my/circle-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data.preferences) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Preferences could not be saved.");
      setData(result); setNotice("Preferences saved. Your placement will be reviewed by the team.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Preferences could not be saved."); } finally { setSaving(false); }
  }
  const field = "mt-2 min-h-11 w-full border border-current/25 bg-transparent p-3 text-sm";
  return <details className="mt-6 min-w-0 max-w-full border-y border-current/20 py-4" open>
    <summary className="cursor-pointer font-semibold">Help us find your Circle</summary>
    <p className="mt-2 max-w-xl text-sm opacity-70">Share the times that usually work for you. These preferences are private to the placement team. A connection is a preference, not a guaranteed placement.</p>
    {data ? <form onSubmit={save} className="mt-4 min-w-0 max-w-full space-y-5">
      <label className="block text-sm">Your time zone<input className={field} value={data.preferences.timezone} onChange={event => setData({ ...data, preferences: { ...data.preferences, timezone: event.target.value } })} placeholder="America/Denver" required maxLength={100} disabled={saving} list="circle-timezones" /></label>
      <datalist id="circle-timezones">{["America/Denver", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Phoenix", "Europe/London", "Australia/Sydney", "Pacific/Auckland", "Asia/Kolkata", "UTC"].map(zone => <option key={zone} value={zone} />)}</datalist>
      <fieldset className="min-w-0 max-w-full" disabled={saving}><legend className="mb-3 text-sm">Usual availability in your time zone · optional</legend>
        <div className="grid gap-2">{CIRCLE_DAYS.map((day, index) => <div className="flex flex-wrap items-center gap-2" key={day}><span className="w-20 text-xs">{day}</span>{CIRCLE_PERIODS.map(period => {
          const slot = `${index}:${period.key}`; const checked = data.preferences.availability.includes(slot);
          return <label key={slot} className={`flex min-h-11 cursor-pointer items-center gap-2 border px-2 text-xs ${checked ? "border-current bg-current/10" : "border-current/20"}`}><input type="checkbox" checked={checked} onChange={() => setData({ ...data, preferences: { ...data.preferences, availability: checked ? data.preferences.availability.filter(value => value !== slot) : [...data.preferences.availability, slot] } })} aria-label={`${day} ${period.label}`} />{period.label}</label>;
        })}</div>)}</div>
      </fieldset>
      {data.connections.length ? <label className="block text-sm">Someone you already know · optional<select className={field} value={data.preferences.preferredConnectionId ?? ""} onChange={event => setData({ ...data, preferences: { ...data.preferences, preferredConnectionId: event.target.value || null } })} disabled={saving}><option value="">No preference</option>{data.connections.map(person => <option key={person.memberId} value={person.memberId}>{person.name}</option>)}</select><span className="mt-2 block text-xs opacity-60">Connections come from your invitation history.</span></label> : null}
      <button className="min-h-11 border border-current px-4 text-sm font-semibold disabled:opacity-40" disabled={saving} type="submit">{saving ? "Saving…" : "Save preferences"}</button>
    </form> : !notice ? <p className="mt-4 text-sm opacity-60">Loading preferences…</p> : null}
    {notice ? <p className="mt-3 text-sm" role="status">{notice}</p> : null}
  </details>;
}
