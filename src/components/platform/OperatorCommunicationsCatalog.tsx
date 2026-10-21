"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  COMMUNICATION_BUCKETS, COMMUNICATION_CHANNELS,
  type CommunicationBucket, type CommunicationChannel, type CommunicationItem,
} from "@/lib/communications/communications-catalog";
import type { CadenceStage } from "@/lib/communications/member-email-cadence-model";
import styles from "./OperatorCommunicationsCatalog.module.css";

export interface OperatorCommunicationsCatalogProps {
  items: CommunicationItem[];
  channel: CommunicationChannel;
  bucket: CommunicationBucket | null;
  onBucket: (bucket: CommunicationBucket | null) => void;
  onSelect: (selection: { scope: "event" | "sequence"; id: string; stage?: CadenceStage }) => void;
  pending?: boolean;
  preview?: boolean;
}

type StatusFilter = "all" | CommunicationItem["status"];
type Filters = { query: string; status: StatusFilter };
const DEFAULT_FILTERS: Filters = { query: "", status: "all" };
const STATUS_LABELS: Record<CommunicationItem["status"], string> = {
  enabled: "Enabled", paused: "Paused", attention: "Needs attention", planned: "Planned", manual: "Manual", held: "Held", approved: "Copy approved",
};
const STATUS_ORDER: CommunicationItem["status"][] = ["enabled", "attention", "paused", "held", "approved", "planned", "manual"];

function counts(items: CommunicationItem[]) {
  return STATUS_ORDER.flatMap(status => {
    const count = items.filter(item => item.status === status).length;
    return count ? [{ status, count, label: STATUS_LABELS[status] }] : [];
  });
}

export default function OperatorCommunicationsCatalog({ items, channel, bucket, onBucket, onSelect, pending = false, preview = false }: OperatorCommunicationsCatalogProps) {
  const [filtersByView, setFiltersByView] = useState<Record<string, Filters>>({});
  const [testsByChannel, setTestsByChannel] = useState<Partial<Record<CommunicationChannel, boolean>>>({});
  const viewKey = `${channel}:${bucket ?? "overview"}`;
  const filters = filtersByView[viewKey] ?? DEFAULT_FILTERS;
  const includeTests = testsByChannel[channel] ?? false;
  const updateFilters = (patch: Partial<Filters>) => setFiltersByView(current => ({ ...current, [viewKey]: { ...(current[viewKey] ?? DEFAULT_FILTERS), ...patch } }));
  const resetFilters = () => { updateFilters(DEFAULT_FILTERS); setTestsByChannel(current => ({ ...current, [channel]: false })); };
  const channelLabel = COMMUNICATION_CHANNELS.find(item => item.value === channel)?.label ?? channel;
  const currentBucket = COMMUNICATION_BUCKETS.find(item => item.value === bucket);
  const allInView = items.filter(item => item.channel === channel && (!bucket || item.bucket === bucket));
  const testCount = allInView.filter(item => item.test).length;
  const visible = allInView.filter(item => includeTests || !item.test);
  const search = filters.query.trim().toLocaleLowerCase();
  const filtered = visible.filter(item => (filters.status === "all" || item.status === filters.status)
    && (!search || [item.title, item.trigger, item.audience, item.timing, item.detail ?? "", item.statusLabel].join(" ").toLocaleLowerCase().includes(search)));
  const filtersChanged = Boolean(filters.query || filters.status !== "all" || includeTests);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.getElementById("communications-catalog-heading")?.focus({ preventScroll: true });
  }, [bucket, channel]);

  function testToggle() {
    return testCount ? <label className={styles.testToggle} htmlFor="communications-include-tests"><input id="communications-include-tests" type="checkbox" checked={includeTests} disabled={pending} onChange={event => { const checked = event.currentTarget.checked; setTestsByChannel(current => ({ ...current, [channel]: checked })); }} /><span>Include tests <span className={styles.muted}>({testCount})</span></span></label> : null;
  }

  function action(item: CommunicationItem) {
    const target = item.action;
    if (!target) return null;
    if (target.selection) return <button className={styles.action} type="button" disabled={pending} onClick={() => onSelect(target.selection!)}>{target.label}<span aria-hidden="true"> →</span></button>;
    if (!target.href) return null;
    if (preview) return <button className={styles.action} type="button" disabled title="Management links are available in the live workspace.">{target.label}<span aria-hidden="true"> ↗</span></button>;
    return <Link className={styles.action} href={target.href}>{target.label}<span aria-hidden="true"> ↗</span></Link>;
  }

  return <section className={styles.catalog} aria-labelledby="communications-catalog-heading" aria-busy={pending}>
    {!currentBucket ? <>
      <header className={styles.overviewHeader}><div><h3 id="communications-catalog-heading" tabIndex={-1}>Browse {channelLabel.toLocaleLowerCase()}</h3><p>Choose a bucket to review its messages, timing, and audience.</p></div>{testToggle()}</header>
      <div className={styles.buckets}>{COMMUNICATION_BUCKETS.map(item => {
        const entries = visible.filter(entry => entry.bucket === item.value);
        const summary = counts(entries);
        return <button className={`operator-glass ${styles.bucket}`} type="button" key={item.value} disabled={pending} onClick={() => onBucket(item.value)} aria-label={`Open ${item.label}: ${entries.length} communications`}>
          <span className={styles.bucketHeading}><strong>{item.label}</strong><span aria-hidden="true">↗</span></span>
          <span className={styles.bucketDescription}>{item.description}</span>
          <span className={styles.bucketCount}><strong>{entries.length}</strong><span>{entries.length === 1 ? "communication" : "communications"}</span></span>
          <span className={styles.bucketStatuses}>{summary.length ? summary.map(value => <span key={value.status} data-status={value.status}>{value.count} {value.label.toLocaleLowerCase()}</span>) : <span>No communications configured</span>}</span>
        </button>;
      })}</div>
      <p className={styles.footnote}>Counts refer to communications, not members or deliveries. Held and planned messages are not active.</p>
    </> : <>
      <button className={styles.back} type="button" disabled={pending} onClick={() => onBucket(null)}>← Back to buckets</button>
      <header className={styles.bucketHeader}><p className={styles.eyebrow}>{channelLabel}</p><h3 id="communications-catalog-heading" tabIndex={-1}>{currentBucket.label}</h3><p className={styles.description}>{currentBucket.description}</p></header>
      <details className={`operator-glass ${styles.filterDisclosure}`}><summary>Search and filter{filtersChanged ? " · Active" : ""}</summary>
      <div className={styles.filters} role="search" aria-label={`Filter ${currentBucket.label} ${channelLabel.toLocaleLowerCase()}`}>
        <label className={styles.search} htmlFor="communications-search">Search<input id="communications-search" type="search" value={filters.query} placeholder="Name, timing, or audience" onChange={event => updateFilters({ query: event.currentTarget.value })} /></label>
        <label className={styles.statusFilter} htmlFor="communications-status">Status<select id="communications-status" value={filters.status} onChange={event => updateFilters({ status: event.currentTarget.value as StatusFilter })}><option value="all">All statuses</option>{STATUS_ORDER.map(status => <option value={status} key={status}>{STATUS_LABELS[status]}</option>)}</select></label>
        {testToggle()}
      </div></details>
      <div className={styles.results}><p role="status" aria-live="polite" aria-atomic="true">{filtered.length === visible.length ? `${filtered.length} ${filtered.length === 1 ? "communication" : "communications"}` : `${filtered.length} of ${visible.length} communications`}{testCount && !includeTests ? <span> · {testCount} {testCount === 1 ? "test" : "tests"} hidden</span> : null}</p>{filtersChanged ? <button type="button" className={styles.reset} onClick={resetFilters}>Reset filters</button> : null}</div>
      {filtered.length ? <ul className={styles.items}>{filtered.map(item => <li className={`operator-glass ${styles.item}`} key={item.id}>
        <div className={styles.itemHeading}><div className={styles.itemIdentity}><h4>{item.title}</h4>{item.test ? <span className={styles.testBadge}>Test</span> : null}</div><span className={`operator-state-label ${styles.status}`} data-state-tone={item.status === "enabled" ? "complete" : item.status === "attention" ? "attention" : undefined} data-status={item.status}>{item.statusLabel}</span></div>
        <dl className={styles.facts}><div><dt>Trigger</dt><dd>{item.trigger}</dd></div><div><dt>Timing</dt><dd>{item.timing}</dd></div><div><dt>Audience</dt><dd>{item.audience}</dd></div></dl>
        {item.detail || item.action ? <div className={styles.itemFooter}>{item.detail ? <details className={styles.details}><summary>Details</summary><p>{item.detail}</p></details> : <span />}{action(item)}</div> : null}
      </li>)}</ul> : <div className={`operator-glass ${styles.empty}`}><h4>{visible.length ? "No communications match these filters." : `No ${channelLabel.toLocaleLowerCase()} configured here yet.`}</h4><p>{visible.length ? "Try a different search or reset the filters." : testCount ? "Only test communications are available in this bucket. Turn on Include tests to review them." : "New messages will appear in this bucket when they are configured. Nothing is scheduled from an empty bucket."}</p>{filtersChanged ? <button className={styles.action} type="button" onClick={resetFilters}>Reset filters →</button> : null}</div>}
      {preview ? <p className={styles.footnote}>Sample workspace. Management links open from the live workspace.</p> : null}
    </>}
  </section>;
}
