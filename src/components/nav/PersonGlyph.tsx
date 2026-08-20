export function PersonGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      preserveAspectRatio="xMidYMid meet"
    >
      <path d="M12.55 2.75a3.45 3.45 0 1 0 0 6.9 3.45 3.45 0 0 0 0-6.9Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.2 21c.45-5.9 3.65-9.05 9.1-9.05 5.15 0 8.15 3.18 8.5 9.05H3.2Zm10.15-8.65h2L13.25 20h-2l2.1-7.65Z"
      />
    </svg>
  );
}
