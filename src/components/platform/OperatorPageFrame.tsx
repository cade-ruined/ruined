export default function OperatorPageFrame({
  children,
  eyebrow,
  introduction,
  title,
}: {
  children: React.ReactNode;
  eyebrow: string;
  introduction?: string;
  title: string;
}) {
  return (
    <main className="-mx-4 -my-10 min-h-[72vh] bg-[var(--color-bone)] px-4 py-10 font-[var(--font-body)] text-[var(--color-faded)] sm:-mx-6 sm:-my-14 sm:px-6 sm:py-14 lg:-mx-10 lg:-my-16 lg:px-10 lg:py-16">
      <header className="border-t border-black/25 pt-5">
        <p className="text-[0.65rem] font-medium uppercase tracking-[0.18em] text-black/45">
          Ruined Operations / {eyebrow}
        </p>
        <div className="mt-10 grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.36fr)] lg:items-end">
          <h1 className="max-w-5xl text-[clamp(3.6rem,8vw,7.8rem)] leading-[0.82] tracking-[-0.045em]">
            {title}
          </h1>
          {introduction ? (
            <p className="max-w-md text-sm leading-relaxed text-black/60 sm:text-base">
              {introduction}
            </p>
          ) : null}
        </div>
      </header>
      {children}
    </main>
  );
}
