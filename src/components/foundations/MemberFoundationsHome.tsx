"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { FOUNDATION_MOMENTS, FOUNDATION_SESSIONS } from "@/data/foundations";
import type { MemberFoundationsState } from "@/lib/foundations/model";

type FoundationApiResponse = {
  error?: string;
  state?: MemberFoundationsState;
};

function chapterProgress(state: MemberFoundationsState, chapterId: string) {
  const moments = FOUNDATION_MOMENTS.filter(
    (moment) => "chapterId" in moment && moment.chapterId === chapterId,
  );
  const momentIds = new Set<string>(moments.map((moment) => moment.id));
  const units = state.units.filter((unit) => momentIds.has(unit.id));
  const completed =
    units.length > 0
      ? units.filter((unit) => unit.status === "completed").length
      : moments.filter((moment) => {
          const index = FOUNDATION_MOMENTS.findIndex((item) => item.id === moment.id);
          return index < state.completedUnits;
        }).length;

  return { completed, total: moments.length };
}

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
  const chapters = useMemo(
    () =>
      FOUNDATION_SESSIONS.map((chapter) => ({
        ...chapter,
        progress: chapterProgress(state, chapter.id),
      })),
    [state],
  );
  const nextMoment = FOUNDATION_MOMENTS.find((moment) => moment.id === state.nextMomentId);
  const hasActiveCircle = state.activeCircleStatus === "active";

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
    <main className="border-t border-white/15 pt-5">
      <div className="flex items-center justify-between gap-6">
        <p className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-white/38">
          My Ruined / Foundations
        </p>
        <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-white/38">
          V{state.version} / {state.status.replaceAll("_", " ")}
        </p>
      </div>

      <section className="mt-14 grid gap-14 lg:grid-cols-[minmax(0,1.35fr)_minmax(21rem,0.65fr)] lg:items-end lg:gap-24">
        <div className="min-w-0">
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-[var(--color-poster)]">
            See · Confront · Cut · Grow
          </p>
          <h1 className="mt-6 font-[var(--font-header)] text-[clamp(2.65rem,12vw,10rem)] font-bold uppercase leading-[0.72] tracking-[-0.075em] lg:text-[clamp(4.5rem,7.5vw,8rem)]">
            Foundations
          </h1>
        </div>
        <div className="border-t border-white/15 pt-5 lg:mb-1">
          <p className="max-w-lg text-base leading-relaxed text-white/55">
            A shared beginning in twenty-two moments. Your reflections stay in the experience;
            only your place in the path is saved.
          </p>
        </div>
      </section>

      <section className="mt-16 border-y border-white/15 py-7 sm:py-9">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.2em] text-white/32">
              Path completed
            </p>
            <p className="mt-3 font-[var(--font-header)] text-4xl font-bold leading-none tracking-[-0.05em] sm:text-5xl">
              {String(state.completedUnits).padStart(2, "0")}
              <span className="ml-2 text-white/25">/ {String(state.totalUnits).padStart(2, "0")}</span>
            </p>
          </div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-white/42">
            {state.progressPercent.toFixed(state.progressPercent % 1 === 0 ? 0 : 2)}%
          </p>
        </div>

        <div
          aria-label={`${state.completedUnits} of ${state.totalUnits} Foundations moments complete`}
          className="mt-7 grid gap-1"
          role="progressbar"
          style={{ gridTemplateColumns: `repeat(${Math.max(state.totalUnits, 1)}, minmax(0, 1fr))` }}
          aria-valuemax={state.totalUnits}
          aria-valuemin={0}
          aria-valuenow={state.completedUnits}
        >
          {Array.from({ length: Math.max(state.totalUnits, 1) }, (_, index) => (
            <span
              aria-hidden="true"
              className={`h-1.5 ${index < state.completedUnits ? "bg-white" : index === state.completedUnits ? "bg-[var(--color-poster)]" : "bg-white/13"}`}
              key={index}
            />
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="font-mono text-[0.53rem] uppercase tracking-[0.18em] text-white/28">
              {state.status === "completed" ? "Path" : "Next moment"}
            </p>
            <p className="mt-2 text-sm text-white/65">
              {state.status === "completed"
                ? "Completed — available to revisit"
                : nextMoment?.label ?? "A shared beginning"}
            </p>
          </div>
          <button
            className="inline-flex min-h-12 items-center gap-8 border border-white bg-white px-5 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-black transition-colors hover:bg-transparent hover:text-white disabled:cursor-wait disabled:opacity-50"
            disabled={pending}
            onClick={enterFoundations}
            type="button"
          >
            <span>{pending ? "Opening" : actionLabel(state)}</span>
            <span aria-hidden>→</span>
          </button>
        </div>
        {error ? (
          <p aria-live="polite" className="mt-5 text-sm text-[#d48b7f]">
            {error}
          </p>
        ) : null}
      </section>

      <section className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)] lg:gap-20">
        <div>
          <div className="flex items-center justify-between border-b border-white/15 pb-4">
            <h2 className="font-mono text-[0.57rem] uppercase tracking-[0.2em] text-white/44">
              Four chapters
            </h2>
            <span className="font-mono text-[0.53rem] uppercase tracking-[0.18em] text-white/25">
              In sequence
            </span>
          </div>
          <ol>
            {chapters.map((chapter) => (
              <li
                className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 py-5"
                key={chapter.id}
              >
                <span className="font-mono text-[0.55rem] text-white/28">{chapter.number}</span>
                <strong className="ui-heading text-base font-semibold uppercase tracking-[-0.015em]">
                  {chapter.title}
                </strong>
                <span className="font-mono text-[0.54rem] uppercase tracking-[0.14em] text-white/34">
                  {chapter.progress.completed}/{chapter.progress.total}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <aside
          className={`border-t pt-5 ${hasActiveCircle ? "border-emerald-300/55" : "border-[var(--color-poster)]/65"}`}
        >
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-[0.56rem] uppercase tracking-[0.2em] text-white/42">
              Completion condition
            </p>
            <span
              className={`size-2 ${hasActiveCircle ? "bg-emerald-300" : "bg-[var(--color-poster)]"}`}
              aria-hidden="true"
            />
          </div>
          <h2 className="mt-8 ui-heading text-[clamp(1.75rem,4vw,3.5rem)] font-semibold leading-[0.94] tracking-[-0.045em]">
            {hasActiveCircle
              ? `${state.activeCircleName ?? "Your Circle"} is in place.`
              : state.readyForCircle
                ? "The work is ready. Your Circle is the final condition."
                : "Begin now. Complete with a Circle."}
          </h2>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-white/48">
            {hasActiveCircle
              ? "Your active Circle satisfies the final Foundations requirement."
              : "A Circle is not required to begin or continue. It becomes required only when you complete the final moment."}
          </p>
          <Link
            className="mt-8 inline-flex border-b border-white/35 pb-1 font-mono text-[0.57rem] uppercase tracking-[0.18em] text-white/60 hover:text-white"
            href="/my/circle"
          >
            {hasActiveCircle ? "View Circle" : "Check Circle status"} →
          </Link>
        </aside>
      </section>
    </main>
  );
}
