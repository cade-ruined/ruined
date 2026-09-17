import Link from "next/link";

export default function MemberSettingsHeader({ title }: { title: string }) {
  return (
    <header className="member-page-heading mb-7 flex flex-wrap items-center justify-between gap-3">
      <h1 className="member-page-title">{title}</h1>
      <Link className="inline-flex min-h-11 items-center text-sm font-semibold underline decoration-[var(--member-rule)] underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4" href="/my">Back to my profile</Link>
    </header>
  );
}
