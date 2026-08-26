"use client";

import { useState } from "react";

import type { MemberTimelineSnapshot } from "@/lib/membership/model";

type DraftEntry = MemberTimelineSnapshot["entries"][number] & { clientKey: string };

const inputClass = "w-full border border-black/20 bg-transparent px-3 py-3 font-[var(--font-body)] text-sm outline-none focus:border-[var(--color-poster)]";

export default function RuinedTimeline({ initialTimeline, writable }: { initialTimeline: MemberTimelineSnapshot; writable: boolean }) {
  const [timeline, setTimeline] = useState(initialTimeline);
  const [entries, setEntries] = useState<DraftEntry[]>(() => initialTimeline.entries.map((entry) => ({ ...entry, clientKey: entry.id })));
  const [pending, setPending] = useState<"complete" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function addEntry() {
    setEntries((current) => [...current, { clientKey: crypto.randomUUID(), details: null, id: "", position: current.length + 1, title: "", year: new Date().getFullYear() }]);
  }

  function updateEntry(key: string, field: "details" | "title" | "year", value: string) {
    setEntries((current) => current.map((entry) => entry.clientKey === key ? { ...entry, [field]: field === "year" ? Number(value) : value } : entry));
    setSaved(false);
  }

  async function save() {
    if (!writable || pending) return null;
    setPending("save");
    setError(null);
    try {
      const response = await fetch("/api/my/timeline", {
        body: JSON.stringify({ action: "save", entries: entries.map((entry) => ({ details: entry.details?.trim() || null, id: entry.id || null, title: entry.title, year: entry.year })) }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string; timeline?: MemberTimelineSnapshot };
      if (!response.ok || !payload.timeline) throw new Error(payload.error || "Your Timeline could not be saved.");
      setTimeline(payload.timeline);
      setEntries(payload.timeline.entries.map((entry) => ({ ...entry, clientKey: entry.id })));
      setSaved(true);
      return payload.timeline;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Your Timeline could not be saved.");
      return null;
    } finally {
      setPending(null);
    }
  }

  async function complete() {
    const current = saved ? timeline : await save();
    if (!current || current.entries.length === 0) return;
    setPending("complete");
    setError(null);
    try {
      const response = await fetch("/api/my/timeline", { body: JSON.stringify({ action: "complete" }), headers: { "content-type": "application/json" }, method: "POST" });
      const payload = (await response.json()) as { error?: string; requirements?: { timeline?: { completedAt?: string | null } } };
      if (!response.ok || !payload.requirements?.timeline?.completedAt) throw new Error(payload.error || "Timeline completion could not be saved.");
      setTimeline((value) => ({ ...value, completedAt: payload.requirements!.timeline!.completedAt ?? null }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Timeline completion could not be saved.");
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="border-t border-white/15 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <p className="font-[var(--font-handwritten)] text-xl text-[var(--color-poster)]">RUINED FOUNDATIONS / TIMELINE</p>
        <p className="font-[var(--font-body)] text-xs uppercase tracking-[0.14em] text-white/38">{timeline.completedAt ? "Completion recorded" : "In progress"}</p>
      </div>
      <header className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)] lg:items-end lg:gap-20">
        <h1 className="font-[var(--font-display)] text-[clamp(4rem,11vw,9rem)] leading-[0.78] tracking-[-0.06em]">The Ruined Timeline.</h1>
        <div className="border-t border-white/15 pt-5">
          <p className="font-[var(--font-body)] text-base leading-relaxed text-white/52">A durable map made from only three things: Year, Title, and optional Details. This Timeline is saved to your private member record. It is not shown to your Circle.</p>
        </div>
      </header>

      <section className="mt-14 bg-[var(--color-bone)] p-5 text-[#201d19] sm:p-8 lg:p-12">
        <div className="flex flex-wrap items-end justify-between gap-5 border-b border-black/20 pb-7">
          <div>
            <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">Year / Title / Details</p>
            <h2 className="mt-3 font-[var(--font-display)] text-4xl tracking-[-0.035em]">Keep only the moments that changed direction.</h2>
          </div>
          <button className="font-[var(--font-body)] text-xs uppercase tracking-[0.14em] text-black/50 underline decoration-black/20 underline-offset-8 hover:text-black" onClick={addEntry} type="button">Add moment +</button>
        </div>
        <ol>
          {entries.map((entry, index) => (
            <li className="grid gap-5 border-b border-black/15 py-7 sm:grid-cols-[7rem_minmax(12rem,0.7fr)_minmax(0,1.3fr)_auto] sm:items-start" key={entry.clientKey}>
              <label className="font-[var(--font-body)] text-[0.6rem] uppercase tracking-[0.13em] text-black/38">Year<input className={`${inputClass} mt-2`} max={2200} min={1900} onChange={(event) => updateEntry(entry.clientKey, "year", event.target.value)} required type="number" value={entry.year} /></label>
              <label className="font-[var(--font-body)] text-[0.6rem] uppercase tracking-[0.13em] text-black/38">Title<input className={`${inputClass} mt-2`} maxLength={200} onChange={(event) => updateEntry(entry.clientKey, "title", event.target.value)} required value={entry.title} /></label>
              <label className="font-[var(--font-body)] text-[0.6rem] uppercase tracking-[0.13em] text-black/38">Details / Optional<textarea className={`${inputClass} mt-2`} maxLength={4000} onChange={(event) => updateEntry(entry.clientKey, "details", event.target.value)} rows={3} value={entry.details ?? ""} /></label>
              <button aria-label={`Remove Timeline moment ${index + 1}`} className="mt-6 font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/35 hover:text-[var(--color-poster)]" onClick={() => { setEntries((current) => current.filter((item) => item.clientKey !== entry.clientKey)); setSaved(false); }} type="button">Remove</button>
            </li>
          ))}
        </ol>
        {!entries.length ? <p className="border-b border-black/15 py-10 font-[var(--font-body)] text-sm text-black/45">Begin with one year and one title. Details can remain empty.</p> : null}
        {error ? <p aria-live="polite" className="mt-6 border-l-2 border-[var(--color-poster)] pl-4 font-[var(--font-body)] text-sm text-black/62">{error}</p> : null}
        <div className="mt-8 flex flex-wrap justify-end gap-3">
          <button className="min-h-12 border border-black px-6 font-[var(--font-body)] text-xs uppercase tracking-[0.14em] text-black hover:bg-black hover:text-white disabled:opacity-40" disabled={!writable || Boolean(pending)} onClick={save} type="button">{pending === "save" ? "Saving" : "Save Timeline"}</button>
          <button className="min-h-12 border border-black bg-black px-6 font-[var(--font-body)] text-xs uppercase tracking-[0.14em] text-white hover:bg-[var(--color-poster)] disabled:opacity-40" disabled={!writable || Boolean(pending) || entries.length === 0} onClick={complete} type="button">{pending === "complete" ? "Recording" : timeline.completedAt ? "Completion recorded" : "Complete Timeline"}</button>
        </div>
      </section>
    </main>
  );
}
