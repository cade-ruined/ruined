import { memberPhotoUrl } from "./photo-policy";

/** Preserve existing site/CDN portraits while rejecting ambiguous or malformed URLs. */
export function safeMemberAvatarUrl(value: string | null): string | null {
  if (!value || /[\s\\\u0000-\u001f\u007f]/.test(value) || value.startsWith("//")) return null;
  if (value.startsWith("/api/member-photos/")) {
    const parts = value.split("/");
    return parts.length === 5 && memberPhotoUrl(parts[3], parts[4]) === value ? value : null;
  }
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}
