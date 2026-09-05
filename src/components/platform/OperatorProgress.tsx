export default function OperatorProgress({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const progress = Math.max(0, Math.min(100, value));
  const complete = progress === 100;

  return (
    <div
      aria-label={`${label}: ${progress}% complete`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={progress}
      className={`h-1.5 w-full overflow-hidden ${
        complete
          ? "bg-[var(--color-verdigris)]/15"
          : "bg-[var(--color-poster)]/15"
      }`}
      role="progressbar"
    >
      <div
        className={`h-full ${
          complete ? "bg-[var(--color-verdigris)]" : "bg-[var(--color-poster)]"
        }`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
