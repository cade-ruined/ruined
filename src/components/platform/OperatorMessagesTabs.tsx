import Link from "next/link";

export default function OperatorMessagesTabs({ active }: { active: "posts" | "alerts" | "emails" }) {
  return <nav aria-label="Message type" className="mb-5 flex flex-wrap gap-1">
    {[
      { id: "posts", label: "Board posts", description: "A lasting announcement members can return to.", href: "/ops/messages?mode=posts" },
      { id: "alerts", label: "Alerts", description: "An immediate notification in the member app.", href: "/ops/messages?mode=alerts" },
      { id: "emails", label: "Emails", description: "Draft and send individual emails or audience campaigns.", href: "/ops/messages?mode=emails" },
    ].map((item) => <Link aria-current={active === item.id ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-none px-4 text-sm font-medium ${active === item.id ? "bg-[var(--operator-surface-muted)] text-black" : "text-black/70 hover:bg-[var(--operator-surface-hover)]"}`} href={item.href} key={item.id}>{item.label}<span className="sr-only"> · {item.description}</span></Link>)}
  </nav>;
}
