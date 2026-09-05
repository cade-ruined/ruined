export const OPS_NOTIFICATION_DELIVERY_STATUSES = [
  "cancelled",
  "delivered",
  "failed",
  "queued",
  "sent",
] as const;

export type OpsNotificationDeliveryStatus =
  (typeof OPS_NOTIFICATION_DELIVERY_STATUSES)[number];

const REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/;

export function normalizeOpsNotificationRequestKey(value: string): string | null {
  const normalized = value.trim();
  return REQUEST_KEY_PATTERN.test(normalized) ? normalized : null;
}

export function resolveOpsNotificationStatusAt(input: {
  createdAt: string;
  deliveredAt: string | null;
  latestStatusEventAt: string | null;
  sentAt: string | null;
  status: OpsNotificationDeliveryStatus;
  updatedAt: string;
}): string {
  if (input.status === "delivered") {
    return input.deliveredAt ?? input.latestStatusEventAt ?? input.sentAt ?? input.updatedAt;
  }
  if (input.status === "sent") {
    return input.sentAt ?? input.latestStatusEventAt ?? input.updatedAt;
  }
  if (input.status === "failed" || input.status === "cancelled") {
    return input.latestStatusEventAt ?? input.updatedAt;
  }
  return input.latestStatusEventAt ?? input.createdAt;
}

export function opsNotificationReadState(
  status: OpsNotificationDeliveryStatus,
  readAt: string | null,
): "read" | "unread" | null {
  if (status !== "delivered") return null;
  return readAt ? "read" : "unread";
}
