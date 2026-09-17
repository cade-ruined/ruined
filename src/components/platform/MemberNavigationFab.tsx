"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import MemberIcon from "@/components/membership/MemberIcon";
import type { MemberAppearance } from "@/components/membership/MemberJourneyShell";
import type { OperatorNavigationRole } from "@/lib/platform/operations-navigation";
import { currentMemberDestination, findMemberDestinations } from "@/lib/membership/navigation";
import styles from "./MemberNavigationFab.module.css";

export default function MemberNavigationFab({appearance = "system", onAppearanceChange, preview, operatorRole, viewerLabel, trigger = "search"}: {
  appearance?: MemberAppearance; onAppearanceChange?: (value: MemberAppearance) => void;
  preview?: boolean; operatorRole?: OperatorNavigationRole | null; viewerLabel?: string | null; trigger?: "search" | "settings";
} = {}) {
  const pathname = usePathname();
  const currentHref = currentMemberDestination(pathname);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const destinations = findMemberDestinations(query);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      setQuery("");
      if (!dialog.open) dialog.showModal();
      if (trigger === "search") searchRef.current?.focus({ preventScroll: true });
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = previousOverflow; };
    }
    if (dialog.open) dialog.close();
  }, [open, trigger]);
  return <>
    <button className={styles.trigger} aria-label={trigger === "search" ? "Search member pages" : "Settings and appearance"} title={trigger === "search" ? "Search member pages" : "Settings and appearance"} aria-haspopup="dialog" aria-controls={menuId} aria-expanded={open} onClick={() => setOpen(true)} ref={triggerRef} type="button"><MemberIcon name={trigger} /></button>
    <dialog className={styles.sheet} id={menuId} ref={dialogRef} aria-labelledby={`${menuId}-title`} onCancel={() => setOpen(false)} onClose={() => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); }} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])');
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className={styles.sheetBody}>
        <header className={styles.heading}><h2 id={`${menuId}-title`}>{trigger === "search" ? "Find your way" : "Make yourself at home"}</h2><button className={styles.close} aria-label="Close menu" type="button" onClick={() => setOpen(false)}>×</button></header>
        {trigger === "settings" ? <>
          <fieldset className={styles.appearance}><legend>Appearance</legend><div>{(["paper", "ink", "system"] as const).map(value => <label key={value}><input type="radio" name={`${menuId}-appearance`} value={value} checked={appearance === value} onChange={() => onAppearanceChange?.(value)} /><span>{value === "paper" ? "Light" : value === "ink" ? "Dark" : "System"}</span></label>)}</div></fieldset>
          <nav aria-label="Account settings" className={styles.account}><Link href="/my/profile" onClick={() => setOpen(false)}>Edit profile & privacy <span>↗</span></Link><Link href="/my/account" onClick={() => setOpen(false)}>Membership & billing <span>↗</span></Link><Link href="/my/support" onClick={() => setOpen(false)}>Support <span>↗</span></Link>{operatorRole ? <Link href="/ops">Operations <span>↗</span></Link> : null}</nav>
          {viewerLabel ? <p className={styles.viewer}>{viewerLabel}</p> : null}
          {viewerLabel && !preview ? <form method="post" action="/api/auth/sign-out?next=/access"><button className="member-button" type="submit">Sign out</button></form> : null}
        </> : <>
          <label className={styles.search}><span className={styles.srOnly}>Find a membership page</span><MemberIcon name="search"/><input ref={searchRef} type="search" autoComplete="off" placeholder="Profile, billing, events…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); } }} /></label>
          <nav aria-label="Membership" className={styles.destinations}>{(["Your record", "Your membership", "Your account"] as const).map(group => {
            const items = destinations.filter(destination => destination.group === group);
            return items.length ? <section key={group}><h3>{group}</h3><ul>{items.map(({href,label}) => <li key={href}><Link href={href} aria-current={currentHref === href ? "page" : undefined} onClick={() => setOpen(false)}><span>{label}</span><span aria-hidden="true">↗</span></Link></li>)}</ul></section> : null;
          })}{!destinations.length ? <p role="status">No matching pages. Try “profile”, “events”, or “help”.</p> : null}</nav>
        </>}
      </div>
    </dialog>
  </>;
}
