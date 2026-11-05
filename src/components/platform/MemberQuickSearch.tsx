"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import MemberIcon from "@/components/membership/MemberIcon";
import { MEMBER_SEARCH_LIMIT, normalizeMemberSearchQuery, type MemberSearchResult, type MemberSearchSnapshot } from "@/lib/membership/member-search-model";
import { getMemberSearchPreview } from "@/lib/membership/member-search-preview";
import styles from "./MemberQuickSearch.module.css";

type SearchState = {
  query: string;
  status: "loading" | "ready" | "error";
  results: MemberSearchResult[];
  more?: boolean;
  error?: "unavailable" | "sign-in" | "denied";
};

function validSnapshot(value: unknown, query: string): value is MemberSearchSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as MemberSearchSnapshot;
  return snapshot.query === query && snapshot.page === 1 && typeof snapshot.hasMore === "boolean"
    && Array.isArray(snapshot.results) && snapshot.results.every(member => member && typeof member === "object"
      && typeof member.name === "string" && typeof member.href === "string" && /^\/profile\/[A-Za-z0-9_-]+$/.test(member.href)
      && (member.memberTag === null || typeof member.memberTag === "string")
      && (member.avatarUrl === null || typeof member.avatarUrl === "string"));
}

function QuickPortrait({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = [words[0]?.[0], words.length > 1 ? words.at(-1)?.[0] : ""].join("").toUpperCase() || "M";
  return <span className={styles.portrait} aria-hidden="true">
    {avatarUrl && !failed ? <Image src={avatarUrl} alt="" width={44} height={44} unoptimized loading="lazy" decoding="async"
      onError={() => setFailed(true)} /> : <span>{initials}</span>}
  </span>;
}

export default function MemberQuickSearch({ query, open, preview = false, onNavigate, id }: {
  query: string; open: boolean; preview?: boolean; onNavigate: () => void; id?: string;
}) {
  const generatedId = useId();
  const normalizedQuery = normalizeMemberSearchQuery(query.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MEMBER_SEARCH_LIMIT));
  const [state, setState] = useState<SearchState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestVersion = useRef(0);

  useEffect(() => {
    const version = ++requestVersion.current;
    const controller = new AbortController();
    if (!open || !normalizedQuery) {
      setState(null);
      return () => controller.abort();
    }
    setState({ query: normalizedQuery, status: "loading", results: [] });
    let timeout: number | undefined;
    const current = () => !controller.signal.aborted && version === requestVersion.current;
    const fail = (error: SearchState["error"]) => {
      if (current()) setState({ query: normalizedQuery, status: "error", results: [], error });
    };
    const debounce = window.setTimeout(async () => {
      try {
        let next: MemberSearchSnapshot;
        if (preview) next = getMemberSearchPreview(normalizedQuery);
        else {
          timeout = window.setTimeout(() => {
            fail("unavailable");
            controller.abort();
          }, 10_000);
          const params = new URLSearchParams({ q: normalizedQuery, page: "1" });
          const response = await fetch(`/api/my/members?${params}`, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) {
            fail(response.status === 401 ? "sign-in" : response.status === 403 ? "denied" : "unavailable");
            return;
          }
          const payload: unknown = await response.json();
          if (!validSnapshot(payload, normalizedQuery)) throw new Error("Invalid member search response");
          next = payload;
        }
        if (current()) setState({ query: normalizedQuery, status: "ready", results: next.results.slice(0, 5),
          more: next.hasMore || next.results.length > 5 });
      } catch {
        fail("unavailable");
      } finally {
        if (timeout !== undefined) window.clearTimeout(timeout);
      }
    }, 250);
    return () => {
      window.clearTimeout(debounce);
      if (timeout !== undefined) window.clearTimeout(timeout);
      controller.abort();
    };
  }, [normalizedQuery, open, preview, attempt]);

  if (!open || !normalizedQuery) return null;
  const current = state?.query === normalizedQuery ? state : null;
  const busy = !current || current.status === "loading";
  const results = current?.status === "ready" ? current.results : [];
  const error = current?.status === "error" ? current.error : null;

  return <section id={id ?? generatedId} className={styles.members} aria-label="Matching members" aria-busy={busy}>
    <div className={styles.heading}><h3>Members</h3><p role="status" aria-live="polite" aria-atomic="true">
      {busy ? "Searching members…" : results.length ? `${results.length}${current?.more ? "+" : ""} ${results.length === 1 ? "match" : "matches"}` : ""}
    </p></div>
    {results.length ? <ul className={styles.results}>{results.map(member => <li key={member.href}>
      <Link className={styles.member} href={member.href} prefetch={false} onClick={onNavigate}>
        <QuickPortrait key={member.avatarUrl ?? "no-portrait"} name={member.name} avatarUrl={member.avatarUrl} />
        <span className={styles.identity}><strong>{member.name}</strong>{member.memberTag ? <small>@{member.memberTag.replace(/^@+/, "")}</small> : null}</span>
        <MemberIcon name="arrow" />
      </Link>
    </li>)}</ul> : current?.status === "ready" ? <p className={styles.message} role="status">No matching members. Try another name or @tag.</p> : null}
    {error ? <div className={styles.error} role="alert">
      <p>{error === "sign-in" ? "Sign in again to search members." : error === "denied" ? "Member access is required to browse profiles." : "Members couldn’t load. Please try again."}</p>
      {error === "sign-in" ? <Link href="/my/access" onClick={onNavigate}>Sign in</Link> : error === "denied"
        ? <Link href="/my/account" onClick={onNavigate}>View account</Link>
        : <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
    </div> : null}
  </section>;
}
