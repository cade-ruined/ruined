import Link from "next/link";

export default function OperatorEventAudienceTabs({ selected, canManagePublic }: { selected: "community" | "members"; canManagePublic: boolean }) {
  return <nav aria-label="Event audiences" className="mb-5 flex flex-wrap gap-2">
    <Link href="/ops/experiences" aria-current={selected === "members" ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-none px-4 text-sm font-medium ${selected === "members" ? "bg-[var(--operator-surface-muted)] text-black" : "text-black/70 hover:bg-[var(--operator-surface-hover)]"}`}>Member events</Link>
    {canManagePublic ? <Link href="/ops/experiences?view=community" aria-current={selected === "community" ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-none px-4 text-sm font-medium ${selected === "community" ? "bg-[var(--operator-surface-muted)] text-black" : "text-black/70 hover:bg-[var(--operator-surface-hover)]"}`}>Public events</Link> : null}
  </nav>;
}
