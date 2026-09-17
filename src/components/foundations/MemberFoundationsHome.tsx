"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FOUNDATION_MOMENTS } from "@/data/foundations";
import type { MemberFoundationsState } from "@/lib/foundations/model";

import styles from "./MemberFoundationsHome.module.css";

type FoundationApiResponse = {
  error?: string;
  state?: MemberFoundationsState;
};

function actionLabel(state: MemberFoundationsState) {
  if (state.status === "completed") return "Revisit Foundations";
  if (!state.enrollmentId || state.status === "not_started") return "Begin Foundations";
  if (state.readyForCircle) return "Return to final moment";
  return "Continue Foundations";
}

export default function MemberFoundationsHome({
  initialState,
  writable,
}: {
  initialState: MemberFoundationsState;
  writable: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextMoment = FOUNDATION_MOMENTS.find((moment) => moment.id === state.nextMomentId);
  const hasActiveCircle = state.activeCircleStatus === "active";
  const completed = state.status === "completed";
  const progress = state.totalUnits > 0
    ? Math.min(100, Math.max(0, (state.completedUnits / state.totalUnits) * 100))
    : 0;

  async function enterFoundations() {
    setError(null);

    if (
      !writable ||
      state.status === "completed" ||
      (state.enrollmentId && state.status !== "not_started")
    ) {
      router.push("/my/foundations/experience");
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/my/foundations", {
        body: JSON.stringify({ action: "start" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as FoundationApiResponse;
      if (!response.ok || !payload.state) {
        throw new Error(payload.error || "Foundations could not be started.");
      }
      setState(payload.state);
      router.push("/my/foundations/experience");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Foundations could not be started.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={`member-journey-page ${styles.page}`}>
      <header className={styles.header}>
        <p className={`member-handwritten ${styles.eyebrow}`}>Your practice</p>
        <h1 className="member-page-title">Foundations</h1>
        <p className={styles.intro}>
          {completed ? "A beginning you can come back to." : "Make room for what matters."}
        </p>
      </header>

      <section aria-label="Your Foundations progress" className={styles.practice}>
        <div className={styles.progressLabel}>
          <span>{completed ? "Completed" : state.enrollmentId ? "Your place" : "A shared beginning"}</span>
          <span>{state.completedUnits} / {state.totalUnits} moments</span>
        </div>
        <div
          aria-label="Foundations moments complete"
          aria-valuemax={state.totalUnits}
          aria-valuemin={0}
          aria-valuenow={state.completedUnits}
          aria-valuetext={`${state.completedUnits} of ${state.totalUnits} moments complete`}
          className={styles.progress}
          role="progressbar"
        >
          <span style={{ width: `${progress}%` }} />
        </div>

        <div className={styles.resume}>
          <p className={styles.moment}>
            {completed ? "Foundations, at your own pace." : nextMoment?.label ?? "A shared beginning"}
          </p>
          <button
            className={`member-button member-button-primary ${styles.continue}`}
            disabled={pending}
            onClick={enterFoundations}
            type="button"
          >
            <span>{pending ? "Opening…" : actionLabel(state)}</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <p className={styles.privacy}>Only your place in the path is saved.</p>
      </section>

      <aside className={styles.circle} aria-label="Circle status">
        <p>
          <span className={styles.circleDot} data-active={hasActiveCircle} aria-hidden="true" />
          {hasActiveCircle
            ? `${state.activeCircleName ?? "Your Circle"} · Active`
            : completed
              ? "Your Circle"
              : "An active Circle is required to complete."}
        </p>
        <Link href="/my/circle">
          {hasActiveCircle || completed ? "My Circle" : "Check Circle status"}
          <span aria-hidden="true">↗</span>
        </Link>
      </aside>
    </main>
  );
}
