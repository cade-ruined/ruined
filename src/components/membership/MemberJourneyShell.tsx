"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import MemberNavigationFab from "@/components/platform/MemberNavigationFab";
import MemberIcon from "@/components/membership/MemberIcon";
import { currentMemberDestination, currentMemberPrimaryDestination, MEMBER_DESTINATIONS, MEMBER_PRIMARY_DESTINATIONS } from "@/lib/membership/navigation";
import type { PlatformConfiguration } from "@/lib/platform/config";
import type { OperatorNavigationRole } from "@/lib/platform/operations-navigation";
import { publicWebsiteHref } from "@/lib/site";
import "@/styles/member-journey-pages.css";
import styles from "./MemberJourneyShell.module.css";

export type MemberAppearance = "system" | "paper" | "ink";
const APPEARANCE_KEY = "ruined-member-appearance";
function appearanceValue(value: string | null): MemberAppearance {
  return value === "paper" || value === "ink" ? value : "system";
}

export default function MemberJourneyShell({ children, configuration, operatorRole, viewerLabel }: {
  children: React.ReactNode;
  configuration: PlatformConfiguration;
  operatorRole?: OperatorNavigationRole | null;
  viewerLabel?: string | null;
}) {
  const pathname = usePathname();
  const [appearance, setAppearance] = useState<MemberAppearance>("system");
  const [systemDark, setSystemDark] = useState(false);
  const threshold = pathname === "/access" || ["/my/access", "/my/confirmed", "/my/join"].some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const focused = pathname.startsWith("/my/foundations/experience");
  const hasNavigation = !threshold && !focused;
  const preview = configuration.mode === "preview";
  const current = currentMemberDestination(pathname);
  const currentPrimary = currentMemberPrimaryDestination(pathname);
  const pageLabel = MEMBER_DESTINATIONS.find(({ href }) => href === current)?.label ?? "Membership";
  const theme = appearance === "system" ? systemDark ? "ink" : "paper" : appearance;

  useEffect(() => {
    try { setAppearance(appearanceValue(window.localStorage.getItem(APPEARANCE_KEY))); } catch { /* The selected theme still works when storage is unavailable. */ }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const synchronize = () => setSystemDark(media.matches);
    synchronize();
    media.addEventListener("change", synchronize);
    return () => media.removeEventListener("change", synchronize);
  }, []);

  function changeAppearance(value: MemberAppearance) {
    setAppearance(value);
    try { window.localStorage.setItem(APPEARANCE_KEY, value); } catch { /* Appearance persists for this visit without storage. */ }
  }

  function primaryLinks() {
    return MEMBER_PRIMARY_DESTINATIONS.map(({ href, label, icon }) => <Link key={href} href={href} className={styles.primaryLink} aria-current={currentPrimary === href ? "page" : undefined}><MemberIcon name={icon} /><span>{label}</span></Link>);
  }

  const menuProps = { appearance, onAppearanceChange: changeAppearance, preview, operatorRole, viewerLabel };
  return <div className={`${styles.journey} ${!hasNavigation ? styles.focused : ""}`} data-member-journey data-member-theme={theme} data-platform-surface="member" data-platform-member-home={pathname === "/my" ? "true" : undefined} data-platform-threshold={threshold ? "true" : undefined}>
    {hasNavigation ? <aside className={styles.sidebar}>
      <Link href="/my" aria-label="My Ruined profile" className={styles.brand}><Image src="/ruined-wordmark.svg" alt="Ruined" width={1000} height={300} priority className={styles.wordmark} /></Link>
      <nav className={styles.desktopNavigation} aria-label="Member pages">{primaryLinks()}</nav>
      <div className={styles.sideBottom}><p>Your membership.<br />Your own way through.</p><Link href="/my/account">Account <MemberIcon name="arrow" /></Link><Link href={publicWebsiteHref("/")}>Back to Ruined <span aria-hidden="true">↗</span></Link></div>
    </aside> : null}
    <div className={styles.workspace}>
      <header className={styles.topbar}>
        <Link href={threshold ? publicWebsiteHref("/") : "/my"} aria-label={threshold ? "Ruined home" : "My Ruined profile"} className={styles.mobileBrand}><Image src="/ruined-wordmark.svg" alt="Ruined" width={1000} height={300} priority className={styles.wordmark} /></Link>
        <div className={styles.breadcrumb}><span>My Ruined</span><span aria-hidden="true">/</span><strong>{pageLabel}</strong></div>
        <div className={styles.tools}>
          <button type="button" className={styles.appearanceToggle} onClick={() => changeAppearance(theme === "paper" ? "ink" : "paper")} aria-label={`Switch to ${theme === "paper" ? "Ink" : "Paper"} appearance`}>{theme === "paper" ? "Ink" : "Paper"}</button>
          {hasNavigation ? <MemberNavigationFab {...menuProps} trigger="search" /> : <Link className={styles.quietLink} href={focused ? "/my/foundations" : "mailto:connect@theruinedproject.com"}>{focused ? "Back to Foundations" : "Support"}</Link>}
          {hasNavigation ? <Link className={styles.iconButton} aria-label="Updates" title="Updates" href="/my/updates"><MemberIcon name="bell" /></Link> : null}
          <MemberNavigationFab {...menuProps} trigger="settings" />
        </div>
      </header>
      {configuration.mode !== "connected" ? <p className={styles.notice} role="status">{preview ? "Preview only. Changes here do not affect your membership." : "Membership is temporarily unavailable. Please try again shortly."}</p> : null}
      <div className={`${styles.content} ${threshold ? styles.thresholdContent : ""} ${focused ? styles.experienceContent : ""}`}>{children}</div>
      {!focused ? <footer className={styles.footer}><span>The Ruined Project</span><Link href={threshold ? "mailto:connect@theruinedproject.com" : "/my/support"}>Need a hand?</Link></footer> : null}
    </div>
    {hasNavigation ? <nav className={styles.mobileNavigation} aria-label="Member pages">{primaryLinks()}</nav> : null}
  </div>;
}
