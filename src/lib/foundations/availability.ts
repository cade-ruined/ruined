import "server-only";

export function isFoundationsLaunched(): boolean {
  return process.env.MEMBERSHIP_FOUNDATIONS_LAUNCHED?.trim().toLowerCase() === "true";
}

export class FoundationsNotLaunchedError extends Error {
  constructor() {
    super("Foundations is not open yet.");
    this.name = "FoundationsNotLaunchedError";
  }
}

export function requireFoundationsLaunched(): void {
  if (!isFoundationsLaunched()) throw new FoundationsNotLaunchedError();
}
