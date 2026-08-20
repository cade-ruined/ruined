import EmailSignupForm from "@/components/EmailSignupForm";

const SECTION_LABELS = {
  store: "Store",
  artifacts: "Artifacts",
  about: "About",
} as const;

export default function JourneyComingSoon({ section }: { section: "store" | "artifacts" | "about" }) {
  return <div className="border border-white/25 bg-black/80 p-4 text-white shadow-[7px_8px_0_rgba(0,0,0,0.5)] sm:p-6">
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="ui-heading text-xs text-[var(--color-poster)]">{SECTION_LABELS[section]}</p><p className="display mt-1 text-[clamp(2.25rem,6vw,3.75rem)] leading-none">Coming soon.</p></div>
      <EmailSignupForm variant="panel" />
    </div>
  </div>;
}
