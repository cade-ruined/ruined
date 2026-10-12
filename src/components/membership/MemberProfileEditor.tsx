"use client";

import Link from "next/link";
import { type ClipboardEvent, type FormEvent, useRef, useState } from "react";

import MemberSettingsHeader from "@/components/membership/MemberSettingsHeader";
import MemberPhotoUpload from "@/components/membership/MemberPhotoUpload";
import { SUPPORT_ACTION_CLASS, SUPPORT_FIELD_CLASS, SUPPORT_LABEL_CLASS, SUPPORT_LINK_CLASS } from "@/components/support/supportStyles";
import type { MemberProfileSnapshot } from "@/lib/membership/model";

import styles from "./MemberProfileEditor.module.css";

const fieldClass = `${SUPPORT_FIELD_CLASS} ${styles.field}`;

function scopeLabel(value: string) {
  return value === "none"
    ? "Keep private"
    : "Share with Circle";
}

export default function MemberProfileEditor({
  initialProfile,
  photoStorageReady,
  writable,
  preview = false,
  timezoneOptions = ["UTC", "America/Denver"],
}: {
  initialProfile: MemberProfileSnapshot;
  photoStorageReady: boolean;
  writable: boolean;
  preview?: boolean;
  timezoneOptions?: string[];
}) {
  const [profile, setProfile] = useState(initialProfile);
  const memberTagRef = useRef<HTMLInputElement>(null);
  const [memberTag, setMemberTag] = useState(initialProfile.directory.memberTag ?? "");
  const [memberTagError, setMemberTagError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [photoDraft, setPhotoDraft] = useState(false);
  const tagLocked = Boolean(profile.directory.memberTag);
  const timezones = [...new Set([...timezoneOptions, profile.directory.timezone ?? "UTC"])].sort();

  function changeMemberTag(value: string) {
    if (tagLocked) return;
    setMemberTag(value.trim().replace(/^@/, "").toLowerCase());
    setMemberTagError(null);
    setError(null);
    setSaved(false);
  }

  function pasteMemberTag(event: ClipboardEvent<HTMLInputElement>) {
    if (tagLocked) return;
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
    const tag = profile.directory.memberTag ?? String(form.get("member-tag") ?? "").trim().replace(/^@/, "").toLowerCase();
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
          bio: String(form.get("bio") ?? ""),
          buildingNow: String(form.get("building-now") ?? ""),
          directory: {
            emailScope: String(form.get("email-scope") ?? "none"),
            phoneScope: String(form.get("phone-scope") ?? "none"),
          },
          fullName: String(form.get("full-name") ?? ""),
          city: String(form.get("city") ?? ""),
          state: String(form.get("state") ?? ""),
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
    <main className={`member-journey-page member-profile-editor mx-auto max-w-[78rem] pb-24 font-[var(--font-body)] text-[var(--member-ink)] ${styles.editor}`}>
      <MemberSettingsHeader title="Edit profile" /><p className={styles.intro}>Your name, @tag, bio, member number, and Timeline appear on your public profile. Your Journal is private.</p>
      {!writable ? <p className="mb-6 rounded-[4px] bg-[var(--member-soft)] p-4 text-base leading-relaxed" role="status">{preview ? "Preview only. Profile changes are not saved." : profile.access.reason ?? "Your profile is read only. Contact support if you need to update it."} {!preview ? <Link className="underline underline-offset-4" href="/my/support">Get help</Link> : null}</p> : null}

      <form onSubmit={save} onChange={() => setSaved(false)}>
        <fieldset className="m-0 min-w-0 space-y-8 border-0 p-0" disabled={!writable || pending || photoPending}>
        <legend className="sr-only">Profile details and contact sharing</legend>
        <section className="grid items-start gap-6 lg:grid-cols-[minmax(13rem,0.5fr)_minmax(0,1fr)] lg:gap-10">
          <div className="max-w-64">
            <MemberPhotoUpload
              avatarUrl={profile.directory.avatarUrl}
              available={photoStorageReady}
              enabled={writable && !pending}
              onBusyChange={setPhotoPending}
              onDraftChange={setPhotoDraft}
              onChange={(avatarUrl) => setProfile((current) => ({ ...current, directory: { ...current.directory, avatarUrl } }))}
            />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <label className={SUPPORT_LABEL_CLASS}>
              Full name
              <input className={fieldClass} defaultValue={profile.directory.fullName || profile.privateProfile.legalName || profile.directory.displayName} key={profile.directory.fullName || profile.directory.displayName} maxLength={120} name="full-name" autoComplete="name" required />
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
                  readOnly={tagLocked}
                  ref={memberTagRef}
                  required={Boolean(profile.directory.memberTag)}
                  spellCheck={false}
                  title="Use 3–24 letters, numbers, or underscores."
                  value={memberTag}
                />
              </span>
              <span className="mt-2 block [font-family:var(--font-body)] font-normal normal-case tracking-normal text-xs leading-relaxed text-[var(--member-muted)]" id="profile-member-tag-help">{tagLocked ? "Your member tag is locked. It stays with you." : "Use 3–24 letters, numbers, or underscores. Your tag is permanent once saved."}</span>
              <span className="mt-2 block [font-family:var(--font-body)] font-normal normal-case tracking-normal text-xs leading-relaxed text-[var(--member-red)]" id="profile-member-tag-error" role="status">{memberTagError}</span>
            </label>
            <label className={SUPPORT_LABEL_CLASS}>
              City
              <input className={fieldClass} defaultValue={profile.directory.city ?? ""} maxLength={100} name="city" autoComplete="address-level2" />
            </label>
            <label className={SUPPORT_LABEL_CLASS}>
              State
              <input className={fieldClass} defaultValue={profile.directory.state ?? ""} maxLength={100} name="state" autoComplete="address-level1" />
            </label>
            <label className={SUPPORT_LABEL_CLASS}>
              Timezone
              <select className={fieldClass} defaultValue={profile.directory.timezone ?? "America/Denver"} name="timezone">{timezones.map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ").replaceAll("/", " / ")}</option>)}</select>
            </label>
            <label className={SUPPORT_LABEL_CLASS + " sm:col-span-2"}>
              What are you building now?
              <textarea className={fieldClass} defaultValue={profile.directory.buildingNow ?? ""} maxLength={500} name="building-now" rows={4} />
            </label>
            <label className={SUPPORT_LABEL_CLASS + " sm:col-span-2"}>
              Bio
              <textarea className={fieldClass} defaultValue={profile.directory.bio ?? ""} maxLength={1200} name="bio" rows={5} />
            </label>

          </div>
        </section>

        <section className="grid gap-6 border-t border-[var(--member-rule)] pt-8 lg:grid-cols-[minmax(13rem,0.5fr)_minmax(0,1fr)] lg:gap-10">
          <div>
            <h2 className={SUPPORT_LABEL_CLASS + " ![font-family:var(--font-cadehandy2)]"}>Contact sharing</h2>
            <p className="mt-3 max-w-md text-base leading-relaxed text-[var(--member-muted)]">Choose whether your Circle can see your email and phone. These never appear on your public profile.</p>
          </div>
          <div>
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

      <p className="mt-8 text-sm text-[var(--member-muted)]">Your card uses your full name. Invite someone through <Link className="underline underline-offset-4" href="/my/invitation">My Invitations</Link>.</p>
      <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-[4px] bg-[var(--member-soft)] p-5">
        <div>
          <h2 className={SUPPORT_LABEL_CLASS + " ![font-family:var(--font-cadehandy2)]"}>Private membership details</h2>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-[var(--member-muted)]">Phone, birth date, shipping address, and apparel sizing.</p>
        </div>
        <Link className={SUPPORT_LINK_CLASS} href="/my/support">Request a details update</Link>
      </section>
    </main>
  );
}
