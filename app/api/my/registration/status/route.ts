import { NextResponse } from "next/server";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getMemberRegistration, MemberRegistrationError } from "@/lib/membership/registration-repository";

export const runtime = "nodejs";
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Read-only. Neither a return URL nor this request completes registration. */
export async function GET() {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return response({ error: "Sign in to check registration." }, 401);
    const registration = await getMemberRegistration(viewer.authUserId);
    return response({ paymentConfirmed: Boolean(registration?.ready && registration.registeredAt &&
      registration.initialPayment) });
  } catch (error) {
    if (error instanceof MemberRegistrationError) return response({ error: "Registration is unavailable for this account." }, error.status);
    return response({ error: "Registration could not be checked. Please try again." }, 503);
  }
}
