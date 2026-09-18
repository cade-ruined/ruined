"use client";

import Link from "next/link";
import { SUPPORT_LABEL_CLASS } from "@/components/support/supportStyles";
import { MEMBER_CARD_LIMITS, type MemberCardSettings, type MemberCardSnapshot } from "@/lib/membership/public-card-model";

export default function MemberPublicSharingSettings({ snapshot, value, onChange }: {
  snapshot: MemberCardSnapshot | null; value: MemberCardSettings | null; onChange: (value: MemberCardSettings) => void;
}) {
  if (!snapshot || !value) return <section><h2 className={SUPPORT_LABEL_CLASS}>Public card</h2><p className="mt-3 text-sm">Sharing choices could not be loaded. Your profile can still be saved. Reload this page to change public sharing.</p></section>;
  const unavailable = value.labelIds.filter(id => !snapshot.availableLabels.some(label => label.id === id));
  return <section className="grid gap-6 lg:grid-cols-[minmax(13rem,0.5fr)_minmax(0,1fr)] lg:gap-10">
    <div><h2 className={SUPPORT_LABEL_CLASS + " ![font-family:var(--font-cadehandy2)]"}>Public card</h2><p className="mt-3 max-w-md text-base leading-relaxed text-[var(--member-muted)]">Your card uses this profile. Fields you select update automatically when saved. Anyone with the public link can read them.</p><Link href="/my/card" className="mt-4 inline-block underline underline-offset-4">Open My Card ↗</Link></div>
    <div>
      <label className="mb-4 flex items-start gap-4 rounded-[4px] bg-[var(--member-soft)] p-4"><input className="mt-1 size-4 shrink-0 accent-[var(--color-poster)]" type="checkbox" checked={value.publicEnabled} disabled={!snapshot.eligible && !value.publicEnabled} onChange={event => onChange({ ...value, publicEnabled: event.target.checked })} /><span><strong className="block text-sm font-medium">Make my card public</strong><span className="mt-2 block text-xs leading-relaxed text-[var(--member-muted)]">Off by default. Your display name is included when enabled. These choices are separate from Circle visibility.</span></span></label>
      {!snapshot.eligible ? <p className="mb-4 text-sm text-[var(--member-muted)]">Public sharing requires an active membership. You can prepare your choices now.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">{([
        ["showPortrait", "Profile photo"], ["showMemberSince", "Member since"], ["showLocation", "Location"],
        ["showBuilding", "What I am building"], ["showBio", "Biography"], ["showWebsite", "Website"],
      ] as const).map(([key, label]) => <label className="flex min-h-12 items-center gap-3 rounded-[4px] bg-[var(--member-soft)] px-4 text-base text-[var(--member-muted)]" key={key}><input type="checkbox" className="size-4 accent-[var(--color-poster)]" checked={value[key]} onChange={event => onChange({ ...value, [key]: event.target.checked })} />{label}</label>)}</div>
      <p className="mt-4 text-xs leading-relaxed text-[var(--member-muted)]">Photo changes apply immediately when portrait sharing is selected. The physical card shows short excerpts; your public page includes the full selected details. Contacts, private notes, legal name, birth date, shipping, and sizing stay private.</p>
      {snapshot.availableLabels.length || unavailable.length ? <fieldset className="mt-6 space-y-3"><legend className={SUPPORT_LABEL_CLASS}>Earned labels / Choose up to two</legend>{snapshot.availableLabels.map(label => {
        const selected = value.labelIds.includes(label.id);
        return <label className="flex items-start gap-3 text-sm" key={label.id}><input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--color-poster)]" checked={selected} disabled={!selected && value.labelIds.length >= MEMBER_CARD_LIMITS.labels} onChange={() => onChange({ ...value, labelIds: selected ? value.labelIds.filter(id => id !== label.id) : [...value.labelIds, label.id] })} /><span>{label.label}</span></label>;
      })}{unavailable.map(id => <label className="flex items-start gap-3 text-sm" key={id}><input type="checkbox" checked onChange={() => onChange({ ...value, labelIds: value.labelIds.filter(value => value !== id) })} />Remove unavailable label</label>)}</fieldset> : null}
    </div>
  </section>;
}
