"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import MemberPageHeader from "@/components/membership/MemberPageHeader";
import MemberPhotoUpload from "@/components/membership/MemberPhotoUpload";
import type { MemberProfileSnapshot } from "@/lib/membership/model";

const fieldClass =
  "mt-2 min-h-12 w-full border border-black/20 bg-transparent px-3 py-3 font-[var(--font-body)] text-sm text-black outline-none transition-colors placeholder:text-black/28 focus:border-[var(--color-poster)]";

function scopeLabel(value: string) {
  return value === "none"
    ? "Keep private"
    : "Share with Circle";
}

export default function MemberProfileEditor({
  initialProfile,
  photoStorageReady,
  writable,
}: {
  initialProfile: MemberProfileSnapshot;
  photoStorageReady: boolean;
  writable: boolean;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || pending || photoPending) return;
    setPending(true);
    setError(null);
    setSaved(false);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/my/profile", {
        body: JSON.stringify({
          accessibilityNotes: String(form.get("accessibility-notes") ?? ""),
          bio: String(form.get("bio") ?? ""),
          buildingNow: String(form.get("building-now") ?? ""),
          directory: {
            avatarVisible: form.get("avatar-visible") === "on",
            bioVisible: form.get("bio-visible") === "on",
            buildingVisible: form.get("building-visible") === "on",
            directoryStatus:
              form.get("circle-directory-enabled") === "on"
                ? "circle_visible"
                : "hidden",
            emailScope: String(form.get("email-scope") ?? "none"),
            locationVisible: form.get("location-visible") === "on",
            phoneScope: String(form.get("phone-scope") ?? "none"),
          },
          displayName: String(form.get("display-name") ?? ""),
          location: String(form.get("location") ?? ""),
          preferredName: String(form.get("preferred-name") ?? ""),
          timezone: String(form.get("timezone") ?? ""),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        profile?: MemberProfileSnapshot;
      };
      if (!response.ok || !payload.profile) {
        throw new Error(payload.error || "Your profile could not be saved.");
      }
      setProfile(payload.profile);
      setSaved(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Your profile could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <MemberPageHeader
        eyebrow="Ruined Membership / Profile"
        imageIntent="A direct, unpolished member portrait against a quiet wall. Window light. No performance."
        imageSequence="07"
        note="be known without being exposed"
        summary="Your public member identity and private administrative record are deliberately separate. You decide what the Circle can see."
        title="Your place, in your words."
      />

      <form className="mt-20" onSubmit={save}>
        <section className="grid gap-10 border-y border-black/20 py-10 lg:grid-cols-[minmax(17rem,0.62fr)_minmax(0,1.38fr)] lg:gap-20 lg:py-14">
          <div>
            <p className="font-[var(--font-body)] text-[0.64rem] font-medium uppercase tracking-[0.16em] text-[var(--color-poster)]">
              Directory identity
            </p>
            <h2 className="mt-5 font-[var(--font-display)] text-5xl leading-[0.92] tracking-[-0.04em]">
              How you appear in the room.
            </h2>
            <p className="mt-6 max-w-md font-[var(--font-body)] text-sm leading-relaxed text-black/48">
              Your name is always part of the active Circle roster. Every other directory field follows the sharing choices below.
            </p>
            <div className="mt-8">
              <p className="[font-family:var(--font-cadehandy2)] text-2xl text-[var(--color-poster)]">Profile photo</p>
              <MemberPhotoUpload
                avatarUrl={profile.directory.avatarUrl}
                available={photoStorageReady}
                enabled={writable && !pending}
                onBusyChange={setPhotoPending}
                onChange={(avatarUrl) => setProfile((current) => ({ ...current, directory: { ...current.directory, avatarUrl } }))}
              />
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <label className="font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/52">
              Display name
              <input className={fieldClass} defaultValue={profile.directory.displayName} maxLength={120} name="display-name" required />
            </label>
            <label className="font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/52">
              Preferred name
              <input className={fieldClass} defaultValue={profile.directory.preferredName ?? ""} maxLength={120} name="preferred-name" required />
            </label>
            <label className="font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/52">
              Location
              <input className={fieldClass} defaultValue={profile.directory.location ?? ""} maxLength={160} name="location" placeholder="City, region" />
            </label>
            <label className="font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/52">
              Timezone
              <input className={fieldClass} defaultValue={profile.directory.timezone ?? "America/Denver"} maxLength={100} name="timezone" />
            </label>
            <label className="font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/52 sm:col-span-2">
              What are you building now?
              <textarea className={fieldClass} defaultValue={profile.directory.buildingNow ?? ""} maxLength={500} name="building-now" rows={4} />
            </label>
            <label className="font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/52 sm:col-span-2">
              Short biography
              <textarea className={fieldClass} defaultValue={profile.directory.bio ?? ""} maxLength={1200} name="bio" rows={5} />
            </label>
          </div>
        </section>

        <section className="grid gap-10 border-b border-black/20 py-10 lg:grid-cols-[minmax(17rem,0.62fr)_minmax(0,1.38fr)] lg:gap-20 lg:py-14">
          <div>
            <p className="font-[var(--font-body)] text-[0.64rem] font-medium uppercase tracking-[0.16em] text-[var(--color-poster)]">
              Circle visibility
            </p>
            <h2 className="mt-5 font-[var(--font-display)] text-5xl leading-[0.92] tracking-[-0.04em]">
              Share by choice.
            </h2>
            <p className="mt-6 max-w-md font-[var(--font-body)] text-sm leading-relaxed text-black/48">
              Legal name, birth date, shipping address, sizing, and accessibility notes never enter the member directory.
            </p>
          </div>
          <div>
            <label className="mb-6 flex items-start gap-4 border border-black/20 p-5 sm:p-6">
              <input
                className="mt-1 size-4 shrink-0 accent-[var(--color-poster)]"
                defaultChecked={profile.preferences.directoryStatus === "circle_visible"}
                name="circle-directory-enabled"
                type="checkbox"
              />
              <span>
                <strong className="block font-[var(--font-body)] text-sm font-medium text-black/72">
                  Make my profile visible inside my Circle
                </strong>
                <span className="mt-2 block font-[var(--font-body)] text-xs leading-relaxed text-black/45">
                  Off by default. Your roster name remains visible, but the optional profile and contact choices below stay hidden until you enable this.
                </span>
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["avatar-visible", "Show my portrait", profile.preferences.avatarVisible],
                ["location-visible", "Show my location", profile.preferences.locationVisible],
                ["building-visible", "Show what I am building", profile.preferences.buildingVisible],
                ["bio-visible", "Show my biography", profile.preferences.bioVisible],
              ].map(([name, label, checked]) => (
                <label className="flex min-h-14 items-center gap-3 border border-black/15 px-4 font-[var(--font-body)] text-sm text-black/62" key={String(name)}>
                  <input className="size-4 accent-[var(--color-poster)]" defaultChecked={Boolean(checked)} name={String(name)} type="checkbox" />
                  {String(label)}
                </label>
              ))}
            </div>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className="font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/52">
                Email sharing
                <select className={fieldClass} defaultValue={profile.preferences.emailScope} name="email-scope">
                  {["none", "circle"].map((scope) => <option key={scope} value={scope}>{scopeLabel(scope)}</option>)}
                </select>
              </label>
              <label className="font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/52">
                Phone sharing
                <select className={fieldClass} defaultValue={profile.preferences.phoneScope} name="phone-scope">
                  {["none", "circle"].map((scope) => <option key={scope} value={scope}>{scopeLabel(scope)}</option>)}
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="grid gap-10 border-b border-black/20 py-10 lg:grid-cols-[minmax(17rem,0.62fr)_minmax(0,1.38fr)] lg:gap-20 lg:py-14">
          <div>
            <p className="font-[var(--font-body)] text-[0.64rem] font-medium uppercase tracking-[0.16em] text-[var(--color-poster)]">Private support</p>
            <h2 className="mt-5 font-[var(--font-display)] text-4xl leading-[0.94] tracking-[-0.035em]">What Ruined should know.</h2>
            <p className="mt-6 max-w-md font-[var(--font-body)] text-sm leading-relaxed text-black/48">This note is for access and support planning. It is never shown to your Circle.</p>
          </div>
          <label className="font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/52">
            Accessibility notes / Optional
            <textarea className={fieldClass} defaultValue={profile.privateProfile.accessibilityNotes ?? ""} maxLength={2000} name="accessibility-notes" rows={7} />
          </label>
        </section>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-5">
          <div>
            {error ? <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 font-[var(--font-body)] text-sm text-black/62">{error}</p> : null}
            {saved ? <p aria-live="polite" className="font-[var(--font-body)] text-sm text-black/48">Profile saved.</p> : null}
          </div>
          <button className="min-h-12 border border-black bg-black px-7 font-[var(--font-body)] text-xs font-medium uppercase tracking-[0.15em] text-white transition-colors hover:bg-[var(--color-poster)] disabled:cursor-wait disabled:opacity-45" disabled={!writable || pending || photoPending} type="submit">{pending ? "Saving" : "Save profile"}</button>
        </div>
      </form>

      <section className="mt-20 grid gap-8 bg-[#080605] px-6 py-10 text-[var(--color-bone)] sm:px-10 lg:grid-cols-[1fr_auto] lg:items-end lg:px-14 lg:py-14">
        <div>
          <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">Administrative record</p>
          <h2 className="mt-4 font-[var(--font-display)] text-4xl leading-none tracking-[-0.035em]">Private membership details.</h2>
          <p className="mt-5 max-w-2xl font-[var(--font-body)] text-sm leading-relaxed text-white/46">Legal identity, mobile, birth date, address, and apparel sizing are changed through membership entry so the required record stays complete.</p>
        </div>
        <Link className="font-[var(--font-body)] text-xs uppercase tracking-[0.14em] text-white/62 underline decoration-white/25 underline-offset-8 hover:text-white" href="/my/join">Review entry details</Link>
      </section>
    </main>
  );
}
