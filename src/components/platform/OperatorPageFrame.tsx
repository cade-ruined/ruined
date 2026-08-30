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
      className="operator-paper -mx-4 -my-10 min-h-[72vh] bg-[var(--color-bone)] px-4 py-8 font-[var(--font-body)] text-[var(--color-faded)] sm:-mx-6 sm:-my-14 sm:px-6 sm:py-10 lg:-mx-10 lg:-my-16 lg:px-10 lg:py-12"
      data-operator-page
    >
      <h1 className="sr-only">{title}</h1>
      <div className="[&>:first-child]:mt-0">{children}</div>
    </main>
  );
}
