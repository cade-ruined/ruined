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
  const stages = [
    MEMBERSHIP_ENTRY_STAGES[0],
    { id: "agreement", label: complimentary ? "Membership" : "Review & pay" },
  ];
  const currentIndex = stage === "profile" ? 0 : 1;
  const current = stages[currentIndex];

  return (
    <section
      aria-labelledby="membership-entry-progress-label"
      className="member-entry-progress mx-auto w-full max-w-4xl py-4"
    >
      <div
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        <p
          className="text-[0.68rem] font-medium uppercase tracking-[0.05em] text-[var(--member-muted)]"
          id="membership-entry-progress-label"
        >
          {current.label}
        </p>
      </div>

      <ol aria-label="Membership entry steps" className="grid grid-cols-2 gap-3">
        {stages.map((item, index) => {
          const status = index < currentIndex
            ? "complete"
            : index === currentIndex
              ? "current"
              : "not started";

          return (
            <li
              aria-current={status === "current" ? "step" : undefined}
              className="flex flex-col gap-2"
              key={item.id}
            >
              <span className={`whitespace-nowrap text-[0.68rem] uppercase tracking-[0.05em] ${status === "current" ? "font-semibold text-[var(--member-ink)]" : "font-medium text-[var(--member-muted)]"}`}>
                {item.label}<span className="sr-only"> — {status}</span>
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
