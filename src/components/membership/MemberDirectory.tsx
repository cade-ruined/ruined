"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import MemberIcon from "./MemberIcon";
import MemberProfileLink from "./MemberProfileLink";
import { memberTier } from "@/lib/membership/member-number";
import { MEMBER_SEARCH_LIMIT, normalizeMemberSearchQuery, type MemberSearchSnapshot } from "@/lib/membership/member-search-model";
import { getMemberSearchPreview } from "@/lib/membership/member-search-preview";
import { fetchMemberRead } from "@/lib/membership/member-read-client";
import styles from "./MemberDirectory.module.css";

type SearchError = { message: string; signIn: boolean; denied: boolean };

function DirectoryPortrait({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = [words[0]?.[0], words.length > 1 ? words.at(-1)?.[0] : ""].join("").toUpperCase() || "M";
  return <span className={styles.portrait} aria-hidden="true">
    {avatarUrl && !failed ? <Image src={avatarUrl} alt="" width={88} height={88} unoptimized
      loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <span>{initials}</span>}
  </span>;
}

function initialQuery(params: Pick<URLSearchParams, "get"> | null, fallback: string): string {
  // The router knows the destination before the address bar commits a navigation.
  // Its query also restores the current filter when Back reuses a cached page.
  return normalizeMemberSearchQuery((params ? params.get("q") ?? "" : fallback)
    .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MEMBER_SEARCH_LIMIT));
}

export default function MemberDirectory({ initialSearch, preview = false }: {
  initialSearch: MemberSearchSnapshot; preview?: boolean;
}) {
  const routeParams = useSearchParams();
  const pathname = usePathname();
  const routeQuery = initialQuery(pathname === "/my/members" ? routeParams : null, initialSearch.query);
  const [input, setInput] = useState(routeQuery);
  const [page, setPage] = useState(initialSearch.page);
  const [search, setSearch] = useState(initialSearch);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SearchError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const firstRequest = useRef(true);
  const requestVersion = useRef(0);
  const previousRouteQuery = useRef(routeQuery);
  const previousInitialSearch = useRef(initialSearch);
  const ownRouteQueries = useRef<string[]>([]);
  const query = normalizeMemberSearchQuery(input);
  const queryChanged = search.query !== query;
  const visibleResults = queryChanged || error?.signIn || error?.denied ? [] : search.results;
  const busy = pending || queryChanged && !error;

  useEffect(() => {
    // Intercepted public profiles change the URL while keeping this directory
    // mounted underneath. Their search params do not belong to the directory.
    if (pathname !== "/my/members") return;
    const navigated = previousInitialSearch.current !== initialSearch;
    if (!navigated && previousRouteQuery.current === routeQuery) return;
    previousInitialSearch.current = initialSearch;
    previousRouteQuery.current = routeQuery;
    // Next can acknowledge our history writes after someone has typed more.
    // Those acknowledgements must not replace their newer input.
    const ownUpdate = ownRouteQueries.current.indexOf(routeQuery);
    // A server navigation is authoritative even when it reuses the same query
    // key and a coalesced history write left that query in the local queue.
    if (!navigated && ownUpdate >= 0) {
      ownRouteQueries.current.splice(0, ownUpdate + 1);
      return;
    }
    ownRouteQueries.current = [];
    // Menu navigation can reuse this component after a locally edited search.
    // Our own URL updates already match the input and retain loaded pages.
    if (routeQuery === query) return;
    setInput(routeQuery);
    setPage(1);
    setAttempt(0);
    setError(null);
  }, [pathname, routeQuery, query, initialSearch]);

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
          const response = await fetchMemberRead(`/api/my/members?${params}`, { signal: controller.signal });
          if (!response.ok) {
            if (controller.signal.aborted || version !== requestVersion.current) return;
            setError({ signIn: response.status === 401, denied: response.status === 403,
              message: response.status === 401 ? "Sign in again to browse members."
                : response.status === 403 ? "Member access is required to browse profiles."
                : "Members couldn’t load. Please try again." });
            return;
          }
          next = response.data as MemberSearchSnapshot;
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
          if ((query !== previousRouteQuery.current || ownRouteQueries.current.length)
              && ownRouteQueries.current.at(-1) !== query) ownRouteQueries.current.push(query);
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
            <MemberProfileLink href={member.href} className={styles.member}>
              <div className={styles.memberTop}><span className={styles.membership}>{tier ? `${tier.label} · No. ${tier.displayNumber}` : "Member"}</span><MemberIcon name="arrow" /></div>
              <div className={styles.identity}>
                <DirectoryPortrait key={member.avatarUrl ?? "no-portrait"} name={member.name} avatarUrl={member.avatarUrl} />
                <div className={styles.identityText}>
                  <h3>{member.name}</h3>
                  {member.memberTag ? <p className={styles.tag}>@{member.memberTag.replace(/^@/, "")}</p> : null}
                </div>
              </div>
              {member.bio ? <p className={styles.bio}>{member.bio}</p> : null}
              <span className={styles.profileLink}>View profile<span className={styles.srOnly}> for {member.name}</span></span>
            </MemberProfileLink>
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
