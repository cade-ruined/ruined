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
    <header className="grid items-end gap-10 border-t border-black/20 pt-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)] lg:gap-16">
      <div className="pb-2 lg:pb-10">
        <p className="font-[var(--font-body)] text-[0.66rem] font-medium uppercase tracking-[0.18em] text-black/52">
          {eyebrow}
        </p>
        <p className="mt-12 font-[var(--font-handwritten)] text-2xl leading-none text-[var(--color-poster)] sm:text-3xl">
          {note}
        </p>
        <h1 className="mt-4 max-w-[12ch] font-[var(--font-display)] text-[clamp(3.7rem,9vw,8.8rem)] font-medium leading-[0.8] tracking-[-0.055em]">
          {title}
        </h1>
        <p className="mt-8 max-w-xl font-[var(--font-body)] text-base leading-relaxed text-black/58 sm:text-lg">
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
    <div className="border-y border-black/20 py-12 sm:py-16">
      <p className="font-[var(--font-handwritten)] text-2xl text-[var(--color-poster)]">
        not filled for the sake of filling
      </p>
      <h2 className="mt-5 max-w-2xl font-[var(--font-display)] text-4xl leading-[0.95] tracking-[-0.035em] sm:text-5xl">
        {title}
      </h2>
      <p className="mt-6 max-w-xl font-[var(--font-body)] text-sm leading-relaxed text-black/55 sm:text-base">
        {body}
      </p>
    </div>
  );
}
