"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { OPERATOR_BUTTON_CLASS, OPERATOR_FIELD_CLASS } from "@/components/platform/operatorStyles";
import { emailGroupRuleLabel, SAMPLE_GROUP_PEOPLE, sampleGroupMatches, type EmailGroupPreviewStore, type EmailGroupRuleOptions } from "@/components/platform/emailGroupPreview";
import type { EmailGroupDetail, EmailGroupInput, EmailGroupMember, EmailGroupRule, EmailGroupSummary } from "@/lib/communications/email-group-model";

const API = "/api/ops/emails/groups";
const MUTED = "text-[color:var(--operator-muted)]";
const emptyInput = (): EmailGroupInput => ({ name: "", description: "", mode: "manual", rule: null, members: [] });
const personCount = (count: number | null) => count == null ? "Audience unavailable" : `${count} ${count === 1 ? "person" : "people"}`;
const personKey = (person: EmailGroupMember) => person.email.trim().toLowerCase();
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !result) throw new Error(result?.error ?? "Groups could not be loaded. Try again.");
  return result;
}
export default function OperatorEmailGroups({ groups, ruleOptions, preview = false, previewStore, initialGroupId, createInitially = false, onGroupsChange, onSelect, onPendingChange, onDirtyChange }: {
  groups: EmailGroupSummary[]; ruleOptions: EmailGroupRuleOptions; preview?: boolean; previewStore: EmailGroupPreviewStore;
  initialGroupId?: string; createInitially?: boolean; onGroupsChange: (group: EmailGroupSummary) => void;
  onSelect?: (group: EmailGroupSummary) => void; onPendingChange?: (pending: boolean) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [detail, setDetail] = useState<EmailGroupDetail | null>(null);
  const [draft, setDraft] = useState<EmailGroupInput | null>(createInitially ? emptyInput() : null);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [results, setResults] = useState<EmailGroupMember[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [matches, setMatches] = useState<EmailGroupDetail | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const initialRef = useRef(false);
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const detailIdentity = draft ? `edit:${draft.id ?? "new"}` : detail?.group.id;
  useEffect(() => { if (detailIdentity) detailRef.current?.scrollIntoView({ block: "nearest" }); }, [detailIdentity]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  async function perform(label: string, action: () => Promise<void>) {
    if (pendingRef.current) return;
    pendingRef.current = true; setPending(label); setError(""); setNotice(""); onPendingChange?.(true);
    try { await action(); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "The group could not be updated."); }
    finally { pendingRef.current = false; onPendingChange?.(false); if (mounted.current) setPending(null); }
  }
  async function open(id: string) {
    await perform("load", async () => {
      const loaded = preview ? previewStore.get(id) : await request<EmailGroupDetail>(`${API}/${encodeURIComponent(id)}`);
      if (!loaded) throw new Error("That group is no longer available. Refresh the groups list.");
      if (!mounted.current) return;
      setDetail(loaded); setDraft(null); setDirty(false); setMatches(null); onGroupsChange(loaded.group);
    });
  }
  useEffect(() => {
    if (initialRef.current || !initialGroupId) return;
    initialRef.current = true;
    void open(initialGroupId);
    // Initial selection only; changing groups uses the visible controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGroupId]);
  function change(update: Partial<EmailGroupInput>) {
    if (pendingRef.current) return;
    setDraft(current => current ? { ...current, ...update } : current); setDirty(true); setMatches(null); setError(""); setNotice("");
  }
  function back(force = false) {
    if (pendingRef.current) return;
    if (dirty && !force) { setDiscard(true); return; }
    setDraft(null); setDetail(null); setDirty(false); setDiscard(false); setMatches(null); setError("");
  }
  function newGroup() { if (pendingRef.current) return; setHasMore(false); setDetail(null); setDraft(emptyInput()); setDirty(false); setMatches(null); setResults([]); setMemberQuery(""); }
  function edit() {
    if (!detail || detail.group.archivedAt || pendingRef.current) return;
    setDraft({ id: detail.group.id, revision: detail.group.revision, name: detail.group.name, description: detail.group.description, mode: detail.group.mode, rule: detail.rule, members: [...detail.members] }); setDirty(false); setMatches(null); setResults([]); setHasMore(false); setMemberQuery("");
  }
  function input(): EmailGroupInput {
    if (!draft) throw new Error("Open a group first.");
    if (!draft.name.trim()) throw new Error("Give this group a name.");
    if (draft.mode === "rule" && (!draft.rule || (draft.rule.kind === "event_registrants" && !draft.rule.eventKey) || (draft.rule.kind === "call_audience" && !draft.rule.callEventId) || (draft.rule.kind === "foundations_cohort" && !draft.rule.cohortMonth))) throw new Error("Choose the event, call, or cohort for this rule.");
    return { ...draft, name: draft.name.trim(), description: draft.description.trim(), members: draft.mode === "manual" ? draft.members ?? [] : [], rule: draft.mode === "rule" ? draft.rule : null };
  }
  function localDetail(value: EmailGroupInput): EmailGroupDetail {
    const members = sampleGroupMatches(value.mode === "rule" ? value.rule ?? null : null, value.members ?? []);
    const id = value.id ?? `sample-group-${Date.now()}`;
    return { group: { id, name: value.name, description: value.description, mode: value.mode, revision: (value.revision ?? 0) + 1, archivedAt: null, memberCount: members.length, ruleSummary: emailGroupRuleLabel(value.mode === "rule" ? value.rule ?? null : null, ruleOptions), updatedAt: new Date().toISOString() }, rule: value.mode === "rule" ? value.rule ?? null : null, members };
  }
  async function previewMatches() {
    await perform("preview", async () => { const value = input(); const result = preview ? localDetail(value) : await request<EmailGroupDetail>(API, { action: "preview", group: value }); if (mounted.current) setMatches(result); });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (draft?.mode === "rule" && !matches) return;
    await perform("save", async () => {
      const value = input(); const result = preview ? localDetail(value) : await request<EmailGroupDetail>(API, { action: "save", group: value });
      if (!mounted.current) return;
      if (preview) previewStore.set(result.group.id, result);
      onGroupsChange(result.group); setDetail(result); setDraft(null); setDirty(false); setMatches(null);
      setNotice(preview ? "Group saved for this preview only. No real data or email permissions changed." : "Group saved. Adding people does not change their email permissions.");
      onSelect?.(result.group);
    });
  }
  async function archive() {
    if (!detail) return;
    await perform("archive", async () => {
      const archived = !detail.group.archivedAt;
      const result = preview ? { ...detail, group: { ...detail.group, revision: detail.group.revision + 1, archivedAt: archived ? new Date().toISOString() : null, updatedAt: new Date().toISOString() } } : await request<EmailGroupDetail>(API, { action: "archive", id: detail.group.id, revision: detail.group.revision, archived });
      if (!mounted.current) return;
      if (preview) previewStore.set(result.group.id, result);
      setDetail(result); onGroupsChange(result.group); setNotice(archived ? "Group archived. It is no longer available for new campaigns." : "Group restored.");
    });
  }
  async function findPeople() {
    await perform("search", async () => {
      const result = preview ? { members: SAMPLE_GROUP_PEOPLE.filter(person => `${person.name} ${person.email}`.toLowerCase().includes(memberQuery.trim().toLowerCase())), hasMore: false } : await request<{ members: EmailGroupMember[]; hasMore: boolean }>(`${API}/people?q=${encodeURIComponent(memberQuery.trim())}`);
      if (mounted.current) { setResults(result.members); setHasMore(result.hasMore); if (!result.members.length) setNotice("No known people match this search. Try another name or email."); }
    });
  }
  function toggle(person: EmailGroupMember) {
    const selected = draft?.members ?? [];
    change({ members: selected.some(item => personKey(item) === personKey(person)) ? selected.filter(item => personKey(item) !== personKey(person)) : [...selected, person] });
  }
  function chooseRule(kind: EmailGroupRule["kind"]) {
    const rule: EmailGroupRule = kind === "registered_members" ? { kind, state: "all" } : kind === "event_registrants" ? { kind, eventKey: "" } : kind === "call_audience" ? { kind, callEventId: "" } : kind === "foundations_cohort" ? { kind, cohortMonth: "" } : { kind };
    change({ rule });
  }
  function people(items: EmailGroupMember[], removable = false) {
    return <ul className="mt-3 max-h-80 divide-y divide-[color:var(--operator-line)] overflow-y-auto">{items.map(person => <li className="flex min-w-0 items-start justify-between gap-3 py-3" key={personKey(person)}><div className="min-w-0"><p className="break-words text-sm font-semibold">{person.name || "No name saved"}</p><p className={`mt-1 break-all text-xs ${MUTED}`}>{person.email}</p></div>{removable ? <button className="min-h-11 shrink-0 text-xs underline underline-offset-4" aria-label={`Remove ${person.name || person.email}`} type="button" disabled={!!pending} onClick={() => toggle(person)}>Remove</button> : null}</li>)}</ul>;
  }
  const visible = groups.filter(group => (includeArchived || !group.archivedAt) && `${group.name} ${group.description} ${group.ruleSummary}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="min-w-0" data-operator-dirty={dirty} data-operator-pending={!!pending} ref={detailRef} aria-label="Ruined email groups">
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{draft ? draft.id ? "Edit group" : "Create group" : detail ? detail.group.name : "Groups"}</h3><p className={`mt-2 max-w-2xl text-sm leading-relaxed ${MUTED}`}>Save an audience once and choose it while writing an email. A group defines who to consider; email permissions are checked separately before sending.</p></div>{draft || detail ? <button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} type="button" onClick={() => back()}>Back to groups</button> : <button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} type="button" onClick={newGroup}>Create group</button>}</header>
    {preview ? <p className={`mb-4 text-xs leading-relaxed ${MUTED}`}>Sample groups and people. Changes stay in this page and do not update any account or subscription.</p> : null}
    {error ? <p className="mb-4 text-sm text-[var(--operator-danger)]" role="alert">{error}</p> : null}{notice ? <p className={`mb-4 text-sm ${MUTED}`} role="status">{notice}</p> : null}
    {discard ? <div className="operator-emphasis mb-4 p-4" data-operator-tone="wait" role="alert"><p className="text-sm">Discard the changes to this group?</p><div className="mt-3 flex flex-wrap gap-3"><button className={OPERATOR_BUTTON_CLASS} type="button" onClick={() => setDiscard(false)}>Keep editing</button><button className={OPERATOR_BUTTON_CLASS} type="button" onClick={() => back(true)}>Discard changes</button></div></div> : null}
    {!draft && !detail ? <><div className="mb-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><label className="min-w-0 text-sm" htmlFor="email-group-search">Find a group<input className={OPERATOR_FIELD_CLASS} id="email-group-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or rule" /></label><label className={`flex min-h-12 items-center gap-2 self-end text-sm ${MUTED}`}><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} />Include archived</label></div><ul className="grid gap-3 lg:grid-cols-2">{visible.map(group => <li className="operator-bento-card min-w-0" key={group.id}><div className="flex flex-wrap items-center justify-between gap-2"><p className={`text-xs ${MUTED}`}>{group.mode === "manual" ? "Manual" : "Rule-based"}{group.archivedAt ? " · Archived" : ""}</p><p className={`text-xs ${MUTED}`}>{group.issue ? "Unavailable" : personCount(group.memberCount)}</p></div><h4 className="mt-3 break-words font-semibold">{group.name}</h4><p className={`mt-2 break-words text-xs leading-relaxed ${MUTED}`}>{group.ruleSummary}</p>{group.issue ? <p className="mt-2 text-xs leading-relaxed text-[var(--operator-danger)]">{group.issue}</p> : null}<div className="mt-4 flex flex-wrap gap-3"><button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} type="button" onClick={() => void open(group.id)}>View<span className="sr-only"> {group.name}</span></button>{onSelect && !group.archivedAt && !group.issue && group.memberCount != null ? <button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} type="button" onClick={() => onSelect(group)}>Use group<span className="sr-only"> {group.name}</span></button> : null}</div></li>)}</ul>{!visible.length ? <p className={`operator-bento-card text-sm ${MUTED}`}>{groups.length ? "No groups match this view." : "No groups yet. Create a manual list or an audience that follows a rule."}</p> : null}</> : null}
    {detail && !draft ? <div className="operator-bento-card min-w-0"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className={`text-xs ${MUTED}`}>{detail.group.mode === "manual" ? "Manual group" : "Rule-based group"} · Revision {detail.group.revision}{detail.group.archivedAt ? " · Archived" : ""}</p><p className="mt-3 text-sm leading-relaxed">{detail.group.ruleSummary}</p>{detail.group.description ? <p className={`mt-2 text-sm leading-relaxed ${MUTED}`}>{detail.group.description}</p> : null}</div><div className="flex flex-wrap gap-3">{!detail.group.archivedAt ? <button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} type="button" onClick={edit}>Edit group</button> : null}<button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} type="button" onClick={() => void archive()}>{detail.group.archivedAt ? "Restore group" : "Archive group"}</button>{onSelect && !detail.group.archivedAt && !detail.group.issue && detail.group.memberCount != null ? <button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} type="button" onClick={() => onSelect(detail.group)}>Use group</button> : null}</div></div><h4 className="mt-6 text-sm font-semibold">{detail.group.issue ? "Audience currently unavailable" : `${personCount(detail.group.memberCount)} currently in this group`}</h4>{detail.group.issue ? <p className="mt-2 text-sm text-[var(--operator-danger)]">{detail.group.issue}</p> : null}<p className={`mt-2 text-xs leading-relaxed ${MUTED}`}>This is group membership, not permission to send. The campaign review shows eligible recipients and exclusions.</p>{people(detail.members)}{!detail.members.length && !detail.group.issue ? <p className={`mt-4 text-sm ${MUTED}`}>No people currently match this group.</p> : null}</div> : null}
    {draft ? <form onSubmit={event => void save(event)} className="space-y-5"><fieldset disabled={!!pending} className="operator-bento-card min-w-0 space-y-4"><legend className="sr-only">Group settings</legend><label className="block text-sm" htmlFor="email-group-name">Group name<input className={OPERATOR_FIELD_CLASS} id="email-group-name" maxLength={120} required value={draft.name} onChange={event => change({ name: event.target.value })} /></label><label className="block text-sm" htmlFor="email-group-description">Description <span className={MUTED}>(optional)</span><input className={OPERATOR_FIELD_CLASS} id="email-group-description" maxLength={500} value={draft.description} onChange={event => change({ description: event.target.value })} /></label><label className="block text-sm" htmlFor="email-group-mode">Group type<select className={OPERATOR_FIELD_CLASS} id="email-group-mode" value={draft.mode} onChange={event => change({ mode: event.target.value as "manual" | "rule", rule: event.target.value === "rule" ? draft.rule ?? { kind: "registered_members", state: "all" } : null })}><option value="manual">Manual — choose people</option><option value="rule">Rule-based — update automatically</option></select></label></fieldset>
      {draft.mode === "manual" ? <section className="operator-bento-card min-w-0" aria-labelledby="email-group-people-heading"><h4 className="font-semibold" id="email-group-people-heading">Choose people</h4><p className={`mt-2 text-xs leading-relaxed ${MUTED}`}>Search known Ruined names or email addresses. Your selected people stay selected when you search again.</p><div className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 basis-48 text-sm" htmlFor="email-group-person-search">Name or email<input className={OPERATOR_FIELD_CLASS} disabled={!!pending} id="email-group-person-search" maxLength={120} value={memberQuery} onChange={event => setMemberQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void findPeople(); } }} /></label><button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} type="button" onClick={() => void findPeople()}>{pending === "search" ? "Searching…" : "Find people"}</button></div>{hasMore ? <p className={`mt-3 text-xs ${MUTED}`}>Showing the first 50 matches. Refine the name or email to find someone else.</p> : null}<ul className="mt-4 max-h-72 divide-y divide-[color:var(--operator-line)] overflow-y-auto">{results.map(person => <li className="py-3" key={personKey(person)}><label className="flex min-w-0 items-start gap-3 text-sm"><input className="mt-1 h-4 w-4 shrink-0" type="checkbox" disabled={!!pending || ((draft.members?.length ?? 0) >= 1000 && !draft.members?.some(item => personKey(item) === personKey(person)))} checked={draft.members?.some(item => personKey(item) === personKey(person)) ?? false} onChange={() => toggle(person)} /><span className="min-w-0"><span className="block break-words font-semibold">{person.name || "No name saved"}</span><span className={`mt-1 block break-all text-xs ${MUTED}`}>{person.email}</span></span></label></li>)}</ul><h5 className="mt-5 border-t border-[color:var(--operator-line)] pt-4 text-sm font-semibold">{draft.members?.length ?? 0} selected</h5>{people(draft.members ?? [], true)}</section> : <section className="operator-bento-card min-w-0 space-y-4"><h4 className="font-semibold">Who belongs in this group</h4><label className="block text-sm" htmlFor="email-group-rule">Include people who match<select className={OPERATOR_FIELD_CLASS} disabled={!!pending} id="email-group-rule" value={draft.rule?.kind ?? "registered_members"} onChange={event => chooseRule(event.target.value as EmailGroupRule["kind"])}><option value="registered_members">Registered members</option><option value="general_subscribers">General-update subscribers</option><option value="foundations_cohort">A Foundations cohort</option><option value="event_registrants">Registered for an event</option><option value="call_audience">Eligible for a member call</option></select></label>
        {draft.rule?.kind === "registered_members" ? <label className="block text-sm" htmlFor="email-group-member-state">Member stage<select className={OPERATOR_FIELD_CLASS} disabled={!!pending} id="email-group-member-state" value={draft.rule.state} onChange={event => change({ rule: { kind: "registered_members", state: event.target.value as "all" | "waiting" | "open" } })}><option value="all">All registered members</option><option value="waiting">Waiting for profile access</option><option value="open">Profile access open</option></select></label> : null}
        {draft.rule?.kind === "event_registrants" ? <label className="block text-sm" htmlFor="email-group-event">Event<select className={OPERATOR_FIELD_CLASS} disabled={!!pending} id="email-group-event" required value={draft.rule.eventKey} onChange={event => change({ rule: { kind: "event_registrants", eventKey: event.target.value } })}><option value="">Choose an event</option>{ruleOptions.events.map(item => <option key={item.eventKey} value={item.eventKey}>{item.name}</option>)}</select></label> : null}
        {draft.rule?.kind === "call_audience" ? <label className="block text-sm" htmlFor="email-group-call">Member call<select className={OPERATOR_FIELD_CLASS} disabled={!!pending} id="email-group-call" required value={draft.rule.callEventId} onChange={event => change({ rule: { kind: "call_audience", callEventId: event.target.value } })}><option value="">Choose a call</option>{ruleOptions.calls.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
        {draft.rule?.kind === "foundations_cohort" ? <label className="block text-sm" htmlFor="email-group-cohort">Accepted cohort<select className={OPERATOR_FIELD_CLASS} disabled={!!pending} id="email-group-cohort" required value={draft.rule.cohortMonth} onChange={event => change({ rule: { kind: "foundations_cohort", cohortMonth: event.target.value } })}><option value="">Choose a cohort</option>{ruleOptions.cohorts.map(item => <option key={item.cohortMonth} value={item.cohortMonth}>{item.name}</option>)}</select></label> : null}
        <p className={`text-xs leading-relaxed ${MUTED}`}>{emailGroupRuleLabel(draft.rule ?? null, ruleOptions)}. This rule is resolved from current Ruined records when the group is used.</p><button className={OPERATOR_BUTTON_CLASS} disabled={!!pending} type="button" onClick={() => void previewMatches()}>{pending === "preview" ? "Checking matches…" : "Preview matches"}</button>{matches ? <div className="border-t border-[color:var(--operator-line)] pt-4"><p className="text-sm font-semibold">{personCount(matches.group.memberCount)} {matches.group.memberCount === 1 ? "matches" : "match"} now</p><p className={`mt-2 text-xs ${MUTED}`}>Email permissions are checked separately during campaign review.</p>{people(matches.members)}</div> : null}
      </section>}
      <div className="flex flex-wrap items-center gap-4"><button className={OPERATOR_BUTTON_CLASS} disabled={!!pending || (draft.mode === "rule" && !matches)} type="submit">{pending === "save" ? "Saving…" : preview ? "Save sample group" : onSelect ? "Save and use group" : "Save group"}</button>{draft.mode === "rule" && !matches ? <p className={`text-xs ${MUTED}`}>Preview the current matches before saving this rule.</p> : null}</div>
    </form> : null}
  </section>;
}
