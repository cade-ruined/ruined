import Link from "next/link";

export default function MemberSettingsHeader({ title }: { title: string }) {
  return (
    <header className="mb-7 flex flex-wrap items-center justify-between gap-3">
      <h1 className="ui-heading text-3xl uppercase leading-none tracking-[-0.045em] sm:text-4xl">{title}</h1>
      <Link className="inline-flex min-h-11 items-center text-sm font-semibold underline decoration-black/30 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4" href="/my">Back to my profile</Link>
    </header>
  );
}
