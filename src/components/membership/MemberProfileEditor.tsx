"use client";

import Link from "next/link";
import { type ClipboardEvent, type FormEvent, useRef, useState } from "react";

import MemberSettingsHeader from "@/components/membership/MemberSettingsHeader";
import MemberPublicSharingSettings from "@/components/membership/MemberPublicSharingSettings";
import type { MemberCardSnapshot } from "@/lib/membership/public-card-model";
import MemberPhotoUpload from "@/components/membership/MemberPhotoUpload";
import { SUPPORT_ACTION_CLASS, SUPPORT_FIELD_CLASS, SUPPORT_LABEL_CLASS, SUPPORT_LINK_CLASS } from "@/components/support/supportStyles";
import type { MemberProfileSnapshot } from "@/lib/membership/model";

const fieldClass = SUPPORT_FIELD_CLASS;

function scopeLabel(value: string) {
  return value === "none"
    ? "Keep private"
    : "Share with Circle";
}

export default function MemberProfileEditor({
  initialProfile,
  initialCard = null,
  photoStorageReady,
  writable,
  preview = false,
}: {
  initialProfile: MemberProfileSnapshot;
  initialCard?: MemberCardSnapshot | null;
  photoStorageReady: boolean;
  writable: boolean;
  preview?: boolean;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const memberTagRef = useRef<HTMLInputElement>(null);
  const [memberTag, setMemberTag] = useState(initialProfile.directory.memberTag ?? "");
  const [memberTagError, setMemberTagError] = useState<string | null>(null);
  const [card, setCard] = useState(initialCard);
  const [choices, setChoices] = useState(initialCard?.settings ?? null);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [photoDraft, setPhotoDraft] = useState(false);
  const photoScopePending = Boolean(card && choices && (
    card.settings.publicEnabled !== choices.publicEnabled || card.settings.showPortrait !== choices.showPortrait
  ));

  function changeMemberTag(value: string) {
    setMemberTag(value.trim().replace(/^@/, "").toLowerCase());
    setMemberTagError(null);
    setError(null);
    setSaved(false);
  }

  function pasteMemberTag(event: ClipboardEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    event.preventDefault();
    changeMemberTag(input.value.slice(0, input.selectionStart ?? 0) + event.clipboardData.getData("text") + input.value.slice(input.selectionEnd ?? input.value.length));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || pending || photoPending || photoDraft || conflict) return;
    setPending(true);
    setError(null);
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const tag = String(form.get("member-tag") ?? "").trim().replace(/^@/, "").toLowerCase();
    if ((tag || profile.directory.memberTag) && !/^[a-z0-9_]{3,24}$/.test(tag)) {
      setMemberTagError("Use 3–24 letters, numbers, or underscores.");
      memberTagRef.current?.focus();
      setPending(false);
      return;
    }
    try {
      const response = await fetch("/api/my/profile", {
        body: JSON.stringify({
          revision: profile.revision,
          websiteUrl: String(form.get("website-url") ?? ""),
          ...(card && choices ? { card: { ...choices, version: card.version } } : {}),
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
          memberTag: tag,
          timezone: String(form.get("timezone") ?? ""),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        code?: string;
        error?: string;
        profile?: MemberProfileSnapshot;
        card?: MemberCardSnapshot | null;
      };
      if (!response.ok || !payload.profile) {
        if (payload.code === "member_tag_unavailable") {
          setMemberTagError(payload.error || "That member tag is already taken. Choose another.");
          memberTagRef.current?.focus();
        } else if (response.status === 409) setConflict(true);
        throw new Error(payload.error || "Your profile could not be saved.");
      }
      setProfile(payload.profile);
      setMemberTag(payload.profile.directory.memberTag ?? "");
      setMemberTagError(null);
      setCard(payload.card ?? null); setChoices(payload.card?.settings ?? null);
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
    <main className="member-journey-page member-profile-editor mx-auto max-w-[78rem] pb-24 font-[var(--font-body)] text-[var(--member-ink)]">
      <MemberSettingsHeader title="Edit profile" /><p className="mb-6 text-sm"><Link className="underline underline-offset-4" href="/my/card">My Card ↗</Link></p>
      {!writable ? <p className="mb-6 rounded-[4px] bg-[var(--member-soft)] p-4 text-base leading-relaxed" role="status">{preview ? "Preview only. Profile changes are not saved." : profile.access.reason ?? "Your profile is read only. Contact support if you need to update it."} {!preview ? <Link className="underline underline-offset-4" href="/my/support">Get help</Link> : null}</p> : null}

      <form onSubmit={save} onChange={() => setSaved(false)}>
        <fieldset className="m-0 min-w-0 space-y-8 border-0 p-0" disabled={!writable || pending || photoPending}>
        <legend className="sr-only">Profile details and sharing preferences</legend>
        <section className="grid items-start gap-6 lg:grid-cols-[minmax(13rem,0.5fr)_minmax(0,1fr)] lg:gap-10">
          <div>
            <h2 className={SUPPORT_LABEL_CLASS + " ![font-family:var(--font-cadehandy2)]"}>Profile</h2>
            <div className="mt-4 max-w-64">
              <p className="[font-family:var(--font-cadehandy2)] text-2xl text-[var(--member-red)]">Profile photo</p>
              <MemberPhotoUpload
                avatarUrl={profile.directory.avatarUrl}
                available={photoStorageReady}
                enabled={writable && !pending && !photoScopePending}
                onBusyChange={setPhotoPending}
                onDraftChange={setPhotoDraft}
                onChange={(avatarUrl) => setProfile((current) => ({ ...current, directory: { ...current.directory, avatarUrl } }))}
              />
              {photoScopePending ? <p className="mt-3 text-xs leading-relaxed text-[var(--member-muted)]">Save your sharing choices before changing your photo.</p> : null}
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <label className={SUPPORT_LABEL_CLASS}>
              Display name
              <input className={fieldClass} defaultValue={profile.directory.displayName} key={profile.directory.displayName} maxLength={120} name="display-name" required />
            </label>
            <label className={SUPPORT_LABEL_CLASS} htmlFor="profile-member-tag">
              Member tag
              <span className="relative mt-2 block">
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center [font-family:var(--font-body)] text-base text-[var(--member-muted)]">@</span>
                <input
                  aria-describedby="profile-member-tag-help profile-member-tag-error"
                  aria-invalid={Boolean(memberTagError)}
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect="off"
                  className={`${fieldClass} !mt-0 !pl-8`}
                  id="profile-member-tag"
                  maxLength={24}
                  minLength={3}
                  name="member-tag"
                  onChange={(event) => changeMemberTag(event.currentTarget.value)}
                  onPaste={pasteMemberTag}
                  onInvalid={() => setMemberTagError("Use 3–24 letters, numbers, or underscores.")}
                  pattern="[a-z0-9_]{3,24}"
                  ref={memberTagRef}
                  required={Boolean(profile.directory.memberTag)}
                  spellCheck={false}
                  title="Use 3–24 letters, numbers, or underscores."
                  value={memberTag}
                />
              </span>
              <span className="mt-2 block [font-family:var(--font-body)] font-normal normal-case tracking-normal text-xs leading-relaxed text-[var(--member-muted)]" id="profile-member-tag-help">Use 3–24 letters, numbers, or underscores. Your unique @tag appears alongside your display name when your public card or invitation is enabled.{!profile.directory.memberTag ? " You can leave this blank for now." : ""}</span>
              <span className="mt-2 block [font-family:var(--font-body)] font-normal normal-case tracking-normal text-xs leading-relaxed text-[var(--member-red)]" id="profile-member-tag-error" role="status">{memberTagError}</span>
            </label>
            <label className={SUPPORT_LABEL_CLASS}>
              Location
              <input className={fieldClass} defaultValue={profile.directory.location ?? ""} maxLength={160} name="location" placeholder="City, region" />
            </label>
            <label className={SUPPORT_LABEL_CLASS}>
              Timezone
              <input className={fieldClass} defaultValue={profile.directory.timezone ?? "America/Denver"} maxLength={100} name="timezone" />
            </label>
            <label className={SUPPORT_LABEL_CLASS + " sm:col-span-2"}>
              What are you building now?
              <textarea className={fieldClass} defaultValue={profile.directory.buildingNow ?? ""} maxLength={500} name="building-now" rows={4} />
            </label>
            <label className={SUPPORT_LABEL_CLASS + " sm:col-span-2"}>
              Short biography
              <textarea className={fieldClass} defaultValue={profile.directory.bio ?? ""} maxLength={1200} name="bio" rows={5} />
            </label>
            <label className={SUPPORT_LABEL_CLASS + " sm:col-span-2"}>
              Website / Optional
              <input className={fieldClass} defaultValue={profile.directory.websiteUrl ?? ""} maxLength={300} name="website-url" type="url" inputMode="url" placeholder="https://" pattern="https?://.+" autoComplete="url" />
            </label>
          </div>
        </section>

        <MemberPublicSharingSettings snapshot={card} value={choices} onChange={setChoices} />

        <section className="grid gap-6 lg:grid-cols-[minmax(13rem,0.5fr)_minmax(0,1fr)] lg:gap-10">
          <div>
            <h2 className={SUPPORT_LABEL_CLASS + " ![font-family:var(--font-cadehandy2)]"}>Circle visibility</h2>
            <p className="mt-3 max-w-md text-base leading-relaxed text-[var(--member-muted)]">
              Legal name, birth date, shipping address, sizing, and accessibility notes never enter the member directory.
            </p>
          </div>
          <div>
            <label className="mb-4 flex items-start gap-4 rounded-[4px] bg-[var(--member-soft)] p-4">
              <input
                className="mt-1 size-4 shrink-0 accent-[var(--color-poster)]"
                defaultChecked={profile.preferences.directoryStatus === "circle_visible"}
                name="circle-directory-enabled"
                type="checkbox"
              />
              <span>
                <strong className="block font-[var(--font-body)] text-sm font-medium text-[var(--member-muted)]">
                  Make my profile visible inside my Circle
                </strong>
                <span className="mt-2 block font-[var(--font-body)] text-xs leading-relaxed text-[var(--member-muted)]">
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
                <label className="flex min-h-12 items-center gap-3 rounded-[4px] bg-[var(--member-soft)] px-4 text-base text-[var(--member-muted)]" key={String(name)}>
                  <input className="size-4 accent-[var(--color-poster)]" defaultChecked={Boolean(checked)} name={String(name)} type="checkbox" />
                  {String(label)}
                </label>
              ))}
            </div>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className={SUPPORT_LABEL_CLASS}>
                Email sharing
                <select className={fieldClass} defaultValue={profile.preferences.emailScope} name="email-scope">
                  {["none", "circle"].map((scope) => <option key={scope} value={scope}>{scopeLabel(scope)}</option>)}
                </select>
              </label>
              <label className={SUPPORT_LABEL_CLASS}>
                Phone sharing
                <select className={fieldClass} defaultValue={profile.preferences.phoneScope} name="phone-scope">
                  {["none", "circle"].map((scope) => <option key={scope} value={scope}>{scopeLabel(scope)}</option>)}
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(13rem,0.5fr)_minmax(0,1fr)] lg:gap-10">
          <div>
            <h2 className={SUPPORT_LABEL_CLASS + " ![font-family:var(--font-cadehandy2)]"}>Private notes</h2>
            <p className="mt-3 max-w-md text-base leading-relaxed text-[var(--member-muted)]">For Ruined’s access and support planning. Never shown to your Circle or public card.</p>
          </div>
          <label className={SUPPORT_LABEL_CLASS}>
            Accessibility notes / Optional
            <textarea className={fieldClass} defaultValue={profile.privateProfile.accessibilityNotes ?? ""} maxLength={2000} name="accessibility-notes" rows={4} />
          </label>
        </section>

        </fieldset>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-5">
          <div>
            {error ? <p aria-live="polite" className="border-l-2 border-[var(--color-poster)] pl-4 font-[var(--font-body)] text-sm text-[var(--member-muted)]">{error}</p> : null}
            {conflict ? <p className="mt-3 text-sm">Reload to review the latest profile. This discards unsaved edits. <button type="button" className="underline underline-offset-4" onClick={() => window.location.reload()}>Reload profile</button></p> : null}
            {saved ? <p aria-live="polite" className="font-[var(--font-body)] text-sm text-[var(--member-muted)]">Profile saved.</p> : null}
            {photoDraft ? <p className="mt-3 text-sm" role="status">Use your photo or cancel the crop before saving your profile.</p> : null}
          </div>
          <button className={SUPPORT_ACTION_CLASS} disabled={!writable || pending || photoPending || photoDraft || conflict} type="submit">{pending ? "Saving…" : writable ? "Save profile" : "Read only"}</button>
        </div>
      </form>

      <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-[4px] bg-[var(--member-soft)] p-5">
        <div>
          <h2 className={SUPPORT_LABEL_CLASS + " ![font-family:var(--font-cadehandy2)]"}>Private membership details</h2>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-[var(--member-muted)]">Full name, phone, birth date, shipping address, and apparel sizing.</p>
        </div>
        <Link className={SUPPORT_LINK_CLASS} href="/my/support">Request a details update</Link>
      </section>
    </main>
  );
}
