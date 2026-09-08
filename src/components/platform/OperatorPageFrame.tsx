export default function OperatorPageFrame({
  children,
  title,
}: {
  children: React.ReactNode;
  eyebrow?: string;
  introduction?: string;
  title: string;
}) {
  return (
    <main
      className="operator-paper -mx-4 -my-10 min-h-[72vh] scroll-mt-[calc(var(--ruined-header-height)+1rem)] bg-[var(--color-bone)] px-4 py-6 font-[var(--font-body)] text-[var(--color-faded)] focus:outline-none sm:-mx-6 sm:-my-14 sm:px-6 sm:py-8 lg:-mx-10 lg:-my-16 lg:px-10 lg:py-9"
      data-operator-page
      id="operator-content"
      tabIndex={-1}
    >
      <h1 className="sr-only">{title}</h1>
      <div className="min-w-0 [&>:first-child]:mt-0">{children}</div>
    </main>
  );
}
