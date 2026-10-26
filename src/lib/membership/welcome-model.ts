export type MemberWelcomeSnapshot = {
  /** The authenticated account, never a client-supplied member identifier. */
  ownerId: string;
  dismissedAt: string | null;
  calendarViewedAt: string | null;
  hasJournalEntry: boolean;
};

export type MemberWelcomeAction = "dismiss" | "resume" | "calendar_viewed";

export class MemberWelcomeError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "MemberWelcomeError";
  }
}
