import Link from "next/link";

export default function OperatorMessagesTabs({ active }: { active: "posts" | "alerts" }) {
  return <nav aria-label="Message type" className="mb-6 grid gap-3 sm:grid-cols-2">
    {[
      { id: "posts", label: "Board posts", description: "A lasting announcement members can return to.", href: "/ops/messages?mode=posts" },
      { id: "alerts", label: "Alerts", description: "An immediate notification in the member app.", href: "/ops/messages?mode=alerts" },
    ].map((item) => <Link aria-current={active === item.id ? "page" : undefined} className={`rounded-[4px] border p-4 ${active === item.id ? "border-black bg-black text-white" : "border-black/15 bg-black/[0.025] text-black"}`} href={item.href} key={item.id}><span className="ui-heading block text-base font-semibold">{item.label}</span><span className={`mt-1 block text-sm ${active === item.id ? "text-white/70" : "text-black/60"}`}>{item.description}</span></Link>)}
  </nav>;
}
