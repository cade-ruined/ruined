"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import PresentationShell from "@/components/foundations/PresentationShell";
import { FOUNDATION_MOMENTS } from "@/data/foundations";
import type { MemberFoundationsState } from "@/lib/foundations/model";

type FoundationApiResponse = {
  code?: string;
  error?: string;
  state?: MemberFoundationsState;
};

async function writeFoundationAction(body: Record<string, string>) {
  const response = await fetch("/api/my/foundations", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = (await response.json()) as FoundationApiResponse;
  if (!response.ok || !payload.state) {
    const error = new Error(payload.error || "Your place could not be saved.");
    Object.assign(error, { code: payload.code });
    throw error;
  }
  return payload.state;
}

export default function MemberFoundationsExperience({
  initialState,
  writable,
}: {
  initialState: MemberFoundationsState;
  writable: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [activeIndex, setActiveIndex] = useState(() => {
    const index = FOUNDATION_MOMENTS.findIndex(
      (moment) => moment.id === initialState.nextMomentId,
    );
    return Math.max(index, 0);
  });
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writeInFlight = useRef<string | null>(null);
  const failedMoment = useRef<string | null>(null);
  const resumeMomentId = useRef(
    initialState.nextMomentId ?? FOUNDATION_MOMENTS[0]?.id,
  ).current;

  useEffect(() => {
    if (!writable || saving || completing || state.status === "completed") return;
    if (state.totalUnits < 2 || state.completedUnits >= state.totalUnits - 1) return;
    if (activeIndex !== state.completedUnits + 1) return;

    const completedMoment = FOUNDATION_MOMENTS[activeIndex - 1];
    if (
      !completedMoment ||
      writeInFlight.current === completedMoment.id ||
      failedMoment.current === completedMoment.id
    ) {
      return;
    }

    writeInFlight.current = completedMoment.id;
    setSaving(true);
    setError(null);
    void writeFoundationAction({ action: "progress", momentId: completedMoment.id })
      .then(setState)
      .catch((requestError: unknown) => {
        failedMoment.current = completedMoment.id;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Your place could not be saved.",
        );
      })
      .finally(() => {
        writeInFlight.current = null;
        setSaving(false);
      });
  }, [activeIndex, completing, saving, state, writable]);

  const finalProgressPending =
    writable &&
    activeIndex === state.totalUnits - 1 &&
    state.status !== "completed" &&
    state.completedUnits < state.totalUnits - 1;

  const complete = useCallback(async () => {
    if (state.status === "completed") return true;
    if (saving || completing || finalProgressPending) return false;
    if (state.activeCircleStatus !== "active") {
      router.push("/my/circle");
      return false;
    }
    if (!writable) {
      setError("Completion is disabled in preview mode.");
      return false;
    }

    setCompleting(true);
    setError(null);
    try {
      const nextState = await writeFoundationAction({ action: "complete" });
      setState(nextState);
      return nextState.status === "completed";
    } catch (requestError) {
      const code = (requestError as Error & { code?: string }).code;
      if (code === "circle_required") {
        setState((current) => ({
          ...current,
          activeCircleName: null,
          activeCircleStatus: null,
          completionAvailable: false,
          readyForCircle: true,
        }));
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Foundations could not be completed.",
      );
      return false;
    } finally {
      setCompleting(false);
    }
  }, [completing, finalProgressPending, router, saving, state.activeCircleStatus, state.status, writable]);

  const maxMomentIndex = writable
    ? Math.min(
        state.status === "completed" ? state.totalUnits - 1 : state.completedUnits + 1,
        state.totalUnits - 1,
      )
    : FOUNDATION_MOMENTS.length - 1;

  return (
    <PresentationShell
      basePath="/my/foundations/experience"
      initialMomentId={resumeMomentId}
      member={{
        completed: state.status === "completed",
        error,
        hasActiveCircle: state.activeCircleStatus === "active",
        maxMomentIndex,
        onComplete: complete,
        onMomentChange: (index) => {
          if (index !== activeIndex) {
            failedMoment.current = null;
            setError(null);
          }
          setActiveIndex(index);
        },
        onViewCircle: () => router.push("/my/circle"),
        pending: saving || completing || finalProgressPending,
        progressLabel: writable
          ? saving || finalProgressPending
            ? "Saving place"
            : error
              ? "Save interrupted"
              : "Place saved"
          : "Preview / Not saved",
        progressPercent: state.progressPercent,
      }}
      returnHref="/my/foundations"
    />
  );
}
