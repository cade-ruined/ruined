export class AdminEmailError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AdminEmailError";
  }
}
export function isAdminEmailAddress(value: string): boolean {
  return value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
}
