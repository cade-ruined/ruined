import Link from "next/link";

export default function OperatorEventAudienceTabs({ selected, canManagePublic }: { selected: "community" | "members"; canManagePublic: boolean }) {
  return <nav aria-label="Event audiences" className="mb-5 flex flex-wrap gap-2">
    <Link href="/ops/experiences" aria-current={selected === "members" ? "page" : undefined} className={`rounded-md px-4 py-2 text-sm font-semibold ${selected === "members" ? "bg-[var(--color-faded)] text-[var(--color-bone)]" : "bg-black/5 text-black/65"}`}>Member experiences</Link>
    {canManagePublic ? <Link href="/ops/experiences?view=community" aria-current={selected === "community" ? "page" : undefined} className={`rounded-md px-4 py-2 text-sm font-semibold ${selected === "community" ? "bg-[var(--color-faded)] text-[var(--color-bone)]" : "bg-black/5 text-black/65"}`}>Public community</Link> : null}
  </nav>;
}
