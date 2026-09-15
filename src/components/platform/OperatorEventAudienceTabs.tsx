import Link from "next/link";

export default function OperatorEventAudienceTabs({ selected, canManagePublic }: { selected: "community" | "members"; canManagePublic: boolean }) {
  return <nav aria-label="Event audiences" className="mb-5 flex flex-wrap gap-2">
    <Link href="/ops/experiences" aria-current={selected === "members" ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-[4px] px-4 text-sm font-medium ${selected === "members" ? "bg-black/[0.08] text-black" : "text-black/60 hover:bg-black/[0.04]"}`}>Member events</Link>
    {canManagePublic ? <Link href="/ops/experiences?view=community" aria-current={selected === "community" ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-[4px] px-4 text-sm font-medium ${selected === "community" ? "bg-black/[0.08] text-black" : "text-black/60 hover:bg-black/[0.04]"}`}>Public events</Link> : null}
  </nav>;
}
