export function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 24"
      fill="none"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M7.15 2.7 9.4 2.62l.16 4.1-2.2.08-.21-4.1ZM17.55 2.36l2.18-.08.2 4.08-2.18.08-.2-4.08Z"
      />
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="m4.42 5.2 18.03-.62.7 15.35-19.66.52L4.42 5.2Zm2.1 3.35 14.2-.46.08 1.7-14.38.4.1-1.64Zm.27 3.66 3.28-.1.1 2.75-3.47.1.09-2.75Zm5.28-.17 3.2-.1.12 2.72-3.4.1.08-2.72Zm5.14-.17 3.11-.1.2 2.7-3.38.1.07-2.7ZM6.7 16.28l3.5-.1.08 2.12-3.68.1.1-2.12Zm5.27-.15 3.48-.1.1 2.1-3.65.1.07-2.1Z"
      />
    </svg>
  );
}
