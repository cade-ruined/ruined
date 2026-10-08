"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { OperatorRegistrationFollowUp } from "@/lib/membership/operator-registration-follow-up";
import { OPERATOR_BUTTON_CLASS } from "./operatorStyles";

export default function OperatorRegistrationNextStep({ action, onReviewProfile, disabled = false, preview = false }: {
  action: OperatorRegistrationFollowUp;
  onReviewProfile: () => void;
  disabled?: boolean;
  preview?: boolean;
}) {
  const [notice, setNotice] = useState("");
  const [copying, setCopying] = useState(false);
  const linkField = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  async function copy(kind: "link" | "message") {
    if (disabled || busy.current || !action.memberUrl || !action.message) return;
    busy.current = true; setCopying(true); setNotice("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(`${preview ? "PREVIEW — SAMPLE ONLY\n\n" : ""}${kind === "link" ? action.memberUrl : action.message}`);
      setNotice(`${kind === "link" ? "Link" : "Message"} copied. Paste it into your email or text to ${action.recipient}.`);
    } catch {
      setNotice("Could not copy automatically. Select the link below and copy it manually.");
      linkField.current?.focus(); linkField.current?.select();
    } finally { busy.current = false; setCopying(false); }
  }
  return <section aria-label="Operator next step" className="mt-4 rounded border border-black/10 bg-white/35 p-4 text-sm">
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-black/50">Operator next step</p>
    <h3 className="font-semibold">{action.title}</h3>
    <p className="mt-1 text-xs leading-relaxed text-black/65">{action.detail}</p>
    {action.memberUrl ? <>
      <p className="mt-3 break-words text-xs"><span className="text-black/55">Send to </span><strong>{action.recipient}</strong></p>
      <input ref={linkField} readOnly aria-label="Member follow-up link" value={action.memberUrl} className="mt-2 min-h-11 w-full min-w-0 rounded border border-black/15 bg-white/45 px-3 text-xs" onFocus={event => event.currentTarget.select()} />
      <div className="mt-2 flex flex-wrap gap-2">
        <button className={OPERATOR_BUTTON_CLASS} type="button" disabled={disabled || copying} onClick={() => void copy("link")}>Copy link</button>
        <button className={`${OPERATOR_BUTTON_CLASS} !bg-transparent !text-[var(--color-faded)]`} type="button" disabled={disabled || copying} onClick={() => void copy("message")}>Copy message</button>
      </div>
      {notice ? <p className="mt-2 break-words text-xs text-black/60" role="status">{notice}</p> : null}
    </> : action.kind === "release" ? <button className={`${OPERATOR_BUTTON_CLASS} mt-3`} type="button" disabled={disabled} onClick={onReviewProfile}>Review profile access</button>
      : action.kind === "review" ? <Link className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold underline underline-offset-4" href={action.operatorHref}>Review member record →</Link> : null}
  </section>;
}
