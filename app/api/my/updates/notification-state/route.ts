import { handleMemberNotificationState } from "@/lib/membership/notification-inbox-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handleMemberNotificationState;
