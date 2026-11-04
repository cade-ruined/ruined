"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { previewPracticeSnapshot, type PracticeSnapshot } from "@/lib/practice/model";
import styles from "./MemberPracticeCard.module.css";

export default function MemberPracticeCard({ ownerId, preview = false }: { ownerId: string; preview?: boolean }) {
  const [snapshot, setSnapshot] = useState<PracticeSnapshot | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    let loadSequence = 0;
    if (preview) {
      setSnapshot({ ...previewPracticeSnapshot(), ownerId });
      return () => { current = false; controller.abort(); };
    }
    async function load() {
      const sequence = ++loadSequence;
      try {
        const response = await fetch("/api/my/practice", {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
          headers: { "x-ruined-session-owner": ownerId },
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (current && sequence === loadSequence && payload?.ownerId === ownerId) setSnapshot(payload);
      } catch { /* The Practice destination stays available when its summary cannot load. */ }
    }
    void load();
    const refresh = () => { if (!document.hidden) void load(); };
    window.addEventListener("ruined:member-progress", refresh);
    window.addEventListener("focus", refresh);
    return () => { current = false; controller.abort(); window.removeEventListener("ruined:member-progress", refresh); window.removeEventListener("focus", refresh); };
  }, [ownerId, preview]);

  const record = snapshot?.ownerId === ownerId ? snapshot : null;
  const next = record?.releases.f1 && !record.badges.f1.earned ? {
    title: "Foundations 1", detail: `${record.badges.f1.completed} of 3 timeline entries`, href: "/my/practice?course=f1", action: "Continue",
  } : record?.releases.f4 && !record.badges.f4.earned ? {
    title: "Foundations 4", detail: "A letter to your future self.", href: "/my/practice?course=f4", action: "Continue",
  } : record?.releases.time && !record.badges.time.earned ? {
    title: "TIME", detail: "Make room in MY 168.", href: "/my/practice?course=time", action: "Continue",
  } : {
    title: "Your work", detail: record?.badges.f1.earned ? "Return to your assignments whenever you need." : "Foundations and monthly topics.", href: "/my/practice", action: "Open The Work",
  };
  return <section className={styles.card} aria-label="The Work">
    <div><p className={styles.label}>The Work</p><h2>{next.title}</h2><p className={styles.detail}>{next.detail}</p></div>
    <Link className="member-button member-button-primary" href={next.href}>{next.action} <span aria-hidden="true">→</span></Link>
  </section>;
}
