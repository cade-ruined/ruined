"use client";

import { useEffect, useRef, useState } from "react";

/** Sharing is explicit and performed by the member; this never sends invitations. */
export default function CoupleMembershipApproval({ authorizationId, enabled = true }: { authorizationId?: string; enabled?: boolean }) {
  const requestId = useRef<string | null>(null);
  const [partnerTag, setPartnerTag] = useState("");
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const [authorization, setAuthorization] = useState<{ role: "payer" | "partner"; payerName: string; accepted: boolean } | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authorizationId) return;
    const controller = new AbortController();
    fetch(`/api/stripe/couple-authorization?id=${encodeURIComponent(authorizationId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "This request is unavailable.");
        setAuthorization(payload.authorization);
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "This request is unavailable."); });
    return () => controller.abort();
  }, [authorizationId]);

  async function submit() {
    if (busy || !enabled) return;
    setBusy(true); setError(null);
    try {
      requestId.current ??= crypto.randomUUID();
      const response = await fetch("/api/stripe/couple-authorization", { method: "POST", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(authorizationId ? { action: "accept", authorizationId, approved } :
          { action: "request", requestId: requestId.current, partnerTag: partnerTag.trim().replace(/^@/, "").toLowerCase() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "This request could not be saved.");
      if (authorizationId) setAuthorization(current => current ? { ...current, accepted: true } : current);
      else setApprovalUrl(payload.approvalUrl);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "This request could not be saved."); }
    finally { setBusy(false); }
  }

  return <section className="mt-6 border border-[var(--member-rule)] p-4 text-sm leading-relaxed" aria-label="Couples membership approval">
    {authorizationId ? authorization ? <>
      <h2 className="font-semibold">{authorization.accepted ? "Couples membership approved" : "Approve your couples membership"}</h2>
      <p className="mt-3">{authorization.payerName} will manage the shared bill. You each keep your own account. This approval does not authorize a charge to you.</p>
      {authorization.accepted ? <p className="mt-3">The payer can return to membership entry to review the offer and authorize payment.</p> : authorization.role === "partner" ? <>
        <label className="mt-4 flex items-start gap-3"><input className="mt-1" type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} /><span>I agree to share a couples membership with {authorization.payerName}, using the membership agreement I accepted in my account.</span></label>
        <button className="mt-4 min-h-11 border border-current px-4 disabled:opacity-50" disabled={!approved || busy || !enabled} type="button" onClick={submit}>{busy ? "Saving approval" : "Approve shared membership"}</button>
      </> : <p className="mt-3">Your partner must open this link in their own registered account and approve it.</p>}
    </> : <p>{error ? "Sign in with the member account this request was sent to. Complete your profile and membership agreement before approving it." : "Loading your request…"}</p> : <>
      <h3 className="font-semibold">Connect your two accounts</h3>
      <p className="mt-2">Your partner needs a registered account and must accept their membership agreement. Create a link for them to approve the shared membership. You will review the price before authorizing any payment.</p>
      {approvalUrl ? <><p className="mt-3">Share this approval link with your partner, then review your offer after they approve:</p><a className="mt-2 block break-all underline underline-offset-4" href={approvalUrl}>{approvalUrl}</a></> : <>
        <label className="mt-4 grid gap-2">Partner&apos;s member tag<input className="min-h-11 min-w-0 border border-[var(--member-rule)] bg-transparent px-3" value={partnerTag} maxLength={25} onChange={event => { setPartnerTag(event.target.value); requestId.current = null; }} autoComplete="off" placeholder="@membertag" /></label>
        <button className="mt-4 min-h-11 border border-current px-4 disabled:opacity-50" disabled={!partnerTag.trim() || busy || !enabled} type="button" onClick={submit}>{busy ? "Creating link" : "Create approval link"}</button>
      </>}
    </>}
    {error ? <p className="mt-3" role="status">{error}</p> : null}
  </section>;
}
