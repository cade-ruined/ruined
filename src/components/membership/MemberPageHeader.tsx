import EditorialImagePlaceholder from "@/components/platform/EditorialImagePlaceholder";

export default function MemberPageHeader({
  eyebrow,
  imageIntent,
  imageSequence,
  note,
  summary,
  title,
}: {
  eyebrow: string;
  imageIntent?: string;
  imageSequence?: string;
  note: string;
  summary: string;
  title: string;
}) {
  return (
    <header className="member-editorial-header grid items-end gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(15rem,0.8fr)] lg:gap-10">
      <div className="pb-2 lg:pb-10">
        <p className="font-[var(--font-body)] text-[0.66rem] font-medium uppercase tracking-[0.18em] text-[var(--member-muted)]">
          {eyebrow}
        </p>
        <p className="mt-5 font-[var(--font-handwritten)] text-2xl leading-none text-[var(--member-red)] sm:text-3xl">
          {note}
        </p>
        <h1 className="member-page-title mt-3">
          {title}
        </h1>
        <p className="mt-5 max-w-xl font-[var(--font-body)] text-base leading-relaxed text-[var(--member-muted)] sm:text-lg">
          {summary}
        </p>
      </div>

      {imageIntent ? (
        <EditorialImagePlaceholder
          intent={imageIntent}
          orientation="portrait"
          sequence={imageSequence ?? "01"}
        />
      ) : null}
    </header>
  );
}

export function MemberEmptyRoom({
  body,
  title,
}: {
  body: string;
  title: string;
}) {
  return (
    <div className="border-y border-[var(--member-rule)] py-12 sm:py-16">
      <p className="font-[var(--font-handwritten)] text-2xl text-[var(--member-red)]">
        not filled for the sake of filling
      </p>
      <h2 className="mt-5 max-w-2xl font-[var(--font-display)] text-4xl leading-[0.95] tracking-[-0.035em] sm:text-5xl">
        {title}
      </h2>
      <p className="mt-6 max-w-xl font-[var(--font-body)] text-sm leading-relaxed text-[var(--member-muted)] sm:text-base">
        {body}
      </p>
    </div>
  );
}
