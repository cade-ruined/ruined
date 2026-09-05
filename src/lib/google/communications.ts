import "server-only";

export type GoogleCommunicationKind = "chat" | "meet";

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return metadataRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function metadataUrl(kind: GoogleCommunicationKind, metadata: unknown): string | null {
  const record = metadataRecord(metadata);
  if (!record) return null;
  const keys = kind === "chat"
    ? ["spaceUri", "space_uri", "chatUri", "chat_uri"]
    : ["meetingUri", "meeting_uri", "meetUri", "meet_uri"];

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Google communication links are selected explicitly per environment. A
 * missing or invalid value matches no rows, so a test link can never become a
 * production fallback.
 */
export function googleCommunicationLivemode(): boolean | null {
  const value = process.env.GOOGLE_COMMUNICATIONS_LIVEMODE?.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function safeGoogleCommunicationUrl(
  kind: GoogleCommunicationKind,
  value: string | null | undefined,
): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return null;
    }

    if (kind === "meet") {
      if (url.hostname !== "meet.google.com") return null;
      if (
        url.pathname.length > 129 ||
        !/^\/[a-z]+-[a-z]+-[a-z]+\/?$/.test(url.pathname)
      ) {
        return null;
      }
      url.hash = "";
    } else {
      const directChatSpace =
        url.hostname === "chat.google.com" &&
        /^\/(?:room|space)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
      const gmailChatSpace =
        url.hostname === "mail.google.com" &&
        /^\/mail\/u\/\d+\/?$/.test(url.pathname) &&
        /^#chat\/space\/[A-Za-z0-9_-]+$/.test(url.hash);
      if (!directChatSpace && !gmailChatSpace) return null;
      if (directChatSpace) url.hash = "";
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function googleCommunicationUrlFromMetadata(
  kind: GoogleCommunicationKind,
  metadata: unknown,
): string | null {
  return safeGoogleCommunicationUrl(kind, metadataUrl(kind, metadata));
}
