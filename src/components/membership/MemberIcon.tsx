import type { SVGProps } from "react";

export default function MemberIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: string }) {
  return <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {name === "person" ? <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></> : null}
    {name === "circle" ? <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="7" r="1.3" /><circle cx="7.7" cy="14.5" r="1.3" /><circle cx="16.3" cy="14.5" r="1.3" /></> : null}
    {name === "book" ? <><path d="M12 6C9 4 5 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-2-1-6-1-9 1Z" /><path d="M12 6v14" /></> : null}
    {name === "calendar" ? <><rect x="3" y="5" width="18" height="16" rx="1" /><path d="M7 3v4m10-4v4M3 10h18m-13 5h2m4 0h2" /></> : null}
    {name === "search" ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></> : null}
    {name === "settings" ? <><path d="m9 3-.6 2-2 .9-1.9-.5-2 3.3 1.4 1.5-.1 2.5-1.3 1.5 2 3.3 1.9-.5 2 .9.6 2h4l.6-2 2-.9 1.9.5 2-3.3-1.3-1.5-.1-2.5L20.5 8l-2-3.3-1.9.5-2-.9-.6-2Z" /><circle cx="11" cy="11.5" r="3" /></> : null}
    {name === "bell" ? <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></> : null}
    {name === "sun" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" /></> : null}
    {name === "moon" ? <path d="M20.5 13.2A8.5 8.5 0 0 1 10.8 3.5a8.5 8.5 0 1 0 9.7 9.7Z" /> : null}
    {name === "arrow" ? <path d="M5 12h14m-6-6 6 6-6 6" /> : null}
  </svg>;
}
