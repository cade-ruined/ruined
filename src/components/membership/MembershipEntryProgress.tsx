"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  MEMBERSHIP_ENTRY_STAGES,
  type MembershipEntryStage,
} from "@/lib/membership/entry-stage";

type EntryProgressContextValue = {
  setStage: Dispatch<SetStateAction<MembershipEntryStage>>;
  stage: MembershipEntryStage;
};

const EntryProgressContext = createContext<EntryProgressContextValue | null>(null);

export function MembershipEntryProgressProvider({
  children,
  initialStage,
}: {
  children: ReactNode;
  initialStage: MembershipEntryStage;
}) {
  const [stage, setStage] = useState(initialStage);
  const value = useMemo(() => ({ setStage, stage }), [stage]);

  return (
    <EntryProgressContext.Provider value={value}>
      {children}
    </EntryProgressContext.Provider>
  );
}

export function useMembershipEntryProgressStage(stage: MembershipEntryStage) {
  const setStage = useContext(EntryProgressContext)?.setStage;

  useEffect(() => {
    setStage?.(stage);
  }, [setStage, stage]);
}

export function MembershipEntryProgress({ complimentary = false }: { complimentary?: boolean }) {
  const stage = useContext(EntryProgressContext)?.stage ?? "profile";
  const currentIndex = MEMBERSHIP_ENTRY_STAGES.findIndex((item) => item.id === stage);
  const current = MEMBERSHIP_ENTRY_STAGES[currentIndex];

  return (
    <section
      aria-labelledby="membership-entry-progress-label"
      className="member-entry-progress mx-auto w-full max-w-4xl py-4"
    >
      <div
        aria-atomic="true"
        aria-live="polite"
        className="flex items-baseline justify-between gap-4"
        role="status"
      >
        <p
          className="text-[0.68rem] font-medium uppercase tracking-[0.05em] text-[var(--member-muted)]"
          id="membership-entry-progress-label"
        >
          {complimentary && current.id === "payment" ? "Activation" : current.label}
        </p>
        <p className="text-[0.66rem] uppercase tracking-[0.05em] text-[var(--member-muted)]">
          Step {currentIndex + 1} of 3
        </p>
      </div>

      <ol aria-label="Membership entry steps" className="mt-2 grid grid-cols-3 gap-2">
        {MEMBERSHIP_ENTRY_STAGES.map((item, index) => {
          const status = index < currentIndex
            ? "complete"
            : index === currentIndex
              ? "current"
              : "not started";

          return (
            <li
              aria-current={status === "current" ? "step" : undefined}
              className="flex h-[2px] items-end"
              key={item.id}
            >
              <span className="sr-only">
                Step {index + 1}: {complimentary && item.id === "payment" ? "Activation" : item.label} — {status}
              </span>
              <span
                aria-hidden="true"
                className={`block w-full ${
                  status === "complete"
                    ? "h-[3px] bg-[var(--member-ink)]"
                    : status === "current"
                      ? "h-[3px] bg-[var(--member-yellow)]"
                      : "h-px bg-[var(--member-rule)]"
                }`}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
