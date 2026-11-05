"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import MemberIcon from "./MemberIcon";
import { memberTier } from "@/lib/membership/member-number";
import { MEMBER_SEARCH_LIMIT, normalizeMemberSearchQuery, type MemberSearchSnapshot } from "@/lib/membership/member-search-model";
import { getMemberSearchPreview } from "@/lib/membership/member-search-preview";
import styles from "./MemberDirectory.module.css";

type SearchError = { message: string; signIn: boolean; denied: boolean };

function initialQuery(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const url = new URL(window.location.href);
  if (url.pathname !== "/my/members") return fallback;
  return normalizeMemberSearchQuery((url.searchParams.get("q") ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MEMBER_SEARCH_LIMIT));
}

export default function MemberDirectory({ initialSearch, preview = false }: {
  initialSearch: MemberSearchSnapshot; preview?: boolean;
}) {
  const [input, setInput] = useState(() => initialQuery(initialSearch.query));
  const [page, setPage] = useState(initialSearch.page);
  const [search, setSearch] = useState(initialSearch);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SearchError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const firstRequest = useRef(true);
  const requestVersion = useRef(0);
  const query = normalizeMemberSearchQuery(input);
  const queryChanged = search.query !== query;
  const visibleResults = queryChanged || error?.signIn || error?.denied ? [] : search.results;
  const busy = pending || queryChanged && !error;

  useEffect(() => {
    if (firstRequest.current) {
      firstRequest.current = false;
      if (query === initialSearch.query && page === initialSearch.page) return;
    }
    const controller = new AbortController();
    const version = ++requestVersion.current;
    setPending(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        let next: MemberSearchSnapshot;
        if (preview) next = getMemberSearchPreview(query, page);
        else {
          const params = new URLSearchParams({ q: query, page: String(page) });
          const response = await fetch(`/api/my/members?${params}`, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) {
            if (controller.signal.aborted || version !== requestVersion.current) return;
            setError({ signIn: response.status === 401, denied: response.status === 403,
              message: response.status === 401 ? "Sign in again to browse members."
                : response.status === 403 ? "Member access is required to browse profiles."
                : "Members couldn’t load. Please try again." });
            return;
          }
          next = await response.json();
          if (!Array.isArray(next.results) || next.query !== query || next.page !== page || typeof next.hasMore !== "boolean") {
            throw new Error("Invalid member search response");
          }
        }
        if (controller.signal.aborted || version !== requestVersion.current) return;
        setSearch(previous => ({ ...next, results: page === 1 || previous.query !== next.query ? next.results
          : [...new Map([...previous.results, ...next.results].map(member => [member.href, member])).values()] }));
        const url = new URL(window.location.href);
        if (url.pathname === "/my/members") {
          if (query) url.searchParams.set("q", query); else url.searchParams.delete("q");
          url.searchParams.delete("page");
          window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        }
      } catch {
        if (!controller.signal.aborted && version === requestVersion.current) {
          setError({ message: "Members couldn’t load. Please try again.", signIn: false, denied: false });
        }
      } finally {
        if (!controller.signal.aborted && version === requestVersion.current) setPending(false);
      }
    }, page === 1 ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, page, attempt, preview, initialSearch.query, initialSearch.page]);

  function changeQuery(value: string) {
    setInput(value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MEMBER_SEARCH_LIMIT));
    setPage(1); setAttempt(0);
  }

  return <section className={`member-journey-page ${styles.directory}`} aria-labelledby="member-directory-title">
    <header className={styles.header}>
      <p className={styles.eyebrow}>The people of Ruined</p>
      <h1 id="member-directory-title" className="member-page-title">Members</h1>
      <p className={styles.intro}>Browse the community, or find someone by name or @tag.</p>
    </header>
    <form role="search" aria-label="Find members" className={styles.search} action="/my/members" method="get"
      onSubmit={event => { event.preventDefault(); if (error && !error.signIn && !error.denied) setAttempt(value => value + 1); }}>
      <label htmlFor="member-directory-query" className={styles.label}>Search members</label>
      <div className={styles.searchField}>
        <MemberIcon name="search" />
        <input id="member-directory-query" name="q" type="search" value={input} maxLength={MEMBER_SEARCH_LIMIT}
          autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search"
          placeholder="Name or @tag" onChange={event => changeQuery(event.target.value)}
          aria-controls="member-directory-results" />
        {input ? <button type="button" className={styles.clear} onClick={() => changeQuery("")} aria-label="Clear member search">Clear</button> : null}
      </div>
    </form>
    <div className={styles.resultsHeader}>
      <h2>{query ? "Search results" : "Browse members"}</h2>
      <p role="status" aria-live="polite" aria-atomic="true">{busy ? "Loading members…" : error ? "" : query
        ? `${visibleResults.length}${search.hasMore ? "+" : ""} ${visibleResults.length === 1 ? "match" : "matches"}` : `${visibleResults.length} members · A–Z`}</p>
    </div>
    <div id="member-directory-results" aria-busy={busy}>
      {visibleResults.length ? <ul className={styles.grid}>
        {visibleResults.map(member => {
          const tier = memberTier(member.memberNumber);
          return <li key={member.href}>
            <Link href={member.href} prefetch={false} className={styles.member}>
              <div className={styles.memberTop}><span className={styles.membership}>{tier ? `${tier.label} · No. ${tier.displayNumber}` : "Member"}</span><MemberIcon name="arrow" /></div>
              <h3>{member.name}</h3>
              {member.memberTag ? <p className={styles.tag}>@{member.memberTag.replace(/^@/, "")}</p> : null}
              {member.bio ? <p className={styles.bio}>{member.bio}</p> : null}
              <span className={styles.profileLink}>View profile<span className={styles.srOnly}> for {member.name}</span></span>
            </Link>
          </li>;
        })}
      </ul> : busy ? <div className={styles.loading} aria-hidden="true"><span /><span /><span /><span /></div>
        : !error ? <div className={styles.empty}>
          <h3>{query ? "No matching profiles." : "No profiles to browse yet."}</h3>
          <p>{query ? "Try a different name or @tag, or browse all members." : "Member profiles will appear here when they’re available."}</p>
          {query ? <button className="member-button" type="button" onClick={() => changeQuery("")}>Browse all members</button> : null}
        </div> : null}
      {error ? <div className={styles.error} role="alert"><p>{error.message}</p>
        {error.signIn ? <Link href="/my/access" className="member-button">Sign in</Link> : error.denied
          ? <Link href="/my/account" className="member-button">View account</Link>
          : <button className="member-button" type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
      </div> : null}
      {!error && !queryChanged && search.hasMore ? <div className={styles.more}>
        <button className="member-button" type="button" disabled={busy} onClick={() => setPage(search.page + 1)}>{busy ? "Loading…" : "Load more members"}</button>
      </div> : null}
    </div>
  </section>;
}
