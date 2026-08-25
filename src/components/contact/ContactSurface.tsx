import ContactForm from "@/components/ContactForm";

export default function ContactSurface({
  modal = false,
  titleId,
}: {
  modal?: boolean;
  titleId?: string;
}) {
  const Heading = modal ? "h2" : "h1";

  return (
    <section className="grid gap-12 md:grid-cols-12 md:gap-10 lg:gap-16">
      <div className="md:col-span-5">
        <p className="font-mono text-[0.55rem] uppercase tracking-[0.28em] text-[var(--color-poster)]">
          Studio No. 17 · Alpine, Utah
        </p>
        <Heading
          id={titleId}
          className="display mt-4 text-[clamp(3.8rem,8vw,7.5rem)] leading-[0.82]"
        >
          Ask a question.
        </Heading>
        <address className="mt-10 border-t border-black/20 pt-5 font-mono text-[0.58rem] not-italic uppercase leading-[1.9] tracking-[0.18em] text-black/55">
          395 S Main Street · Alpine, Utah 84004
          <br />
          40.4478° N · 111.7783° W
          <br />
          connect@theruinedproject.com
        </address>
      </div>

      <div className="md:col-span-6 md:col-start-7 md:pt-2">
        <ContactForm />
      </div>
    </section>
  );
}
