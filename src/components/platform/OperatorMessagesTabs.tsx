import Link from "next/link";

export default function OperatorMessagesTabs({ active }: { active: "posts" | "alerts" }) {
  return <nav aria-label="Message type" className="mb-5 flex flex-wrap gap-1">
    {[
      { id: "posts", label: "Board posts", description: "A lasting announcement members can return to.", href: "/ops/messages?mode=posts" },
      { id: "alerts", label: "Alerts", description: "An immediate notification in the member app.", href: "/ops/messages?mode=alerts" },
    ].map((item) => <Link aria-current={active === item.id ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-[4px] px-4 text-sm font-medium ${active === item.id ? "bg-black/[0.08] text-black" : "text-black/60 hover:bg-black/[0.04]"}`} href={item.href} key={item.id}>{item.label}<span className="sr-only"> · {item.description}</span></Link>)}
  </nav>;
}
