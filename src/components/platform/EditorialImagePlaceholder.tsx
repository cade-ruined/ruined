type EditorialImagePlaceholderProps = {
  caption?: string;
  intent: string;
  orientation?: "landscape" | "portrait" | "square";
  sequence?: string;
};

const ASPECTS = {
  landscape: "aspect-[16/10]",
  portrait: "aspect-[4/5]",
  square: "aspect-square",
} as const;

export default function EditorialImagePlaceholder({
  caption = "Photography to come",
  intent,
  orientation = "landscape",
  sequence = "01",
}: EditorialImagePlaceholderProps) {
  return (
    <figure
      aria-label={`${caption}. Direction: ${intent}`}
      className={`relative isolate overflow-hidden bg-[#0b0908] text-[var(--color-bone)] ${ASPECTS[orientation]}`}
    >
      <div aria-hidden="true" className="absolute inset-[7%] border border-white/15" />
      <div aria-hidden="true" className="absolute bottom-0 left-[18%] top-0 w-px bg-white/10" />
      <div aria-hidden="true" className="absolute bottom-[18%] left-0 right-0 h-px bg-white/10" />
      <div aria-hidden="true" className="absolute right-0 top-0 h-[42%] w-[0.45rem] bg-[var(--color-poster)]" />

      <div className="absolute left-[7%] top-[7%] flex items-center gap-3 font-[var(--font-body)] text-[0.58rem] font-medium uppercase tracking-[0.19em] text-white/48">
        <span>{sequence}</span>
        <span className="h-px w-8 bg-white/30" aria-hidden="true" />
        <span>{caption}</span>
      </div>

      <figcaption className="absolute bottom-[8%] left-[8%] right-[12%] max-w-lg">
        <p className="font-[var(--font-handwritten)] text-[clamp(1.3rem,3vw,2.3rem)] leading-[0.95] text-[var(--color-poster)]">
          {intent}
        </p>
      </figcaption>
    </figure>
  );
}
