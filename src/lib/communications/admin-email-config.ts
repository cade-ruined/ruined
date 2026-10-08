import "server-only";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { isAdminEmailAddress } from "./admin-email-model";

export const adminEmailEnvironmentValue = (name: string) => process.env[name]?.trim() ?? "";
export function getAdminEmailSiteUrl(): URL | null {
  try {
    const url = new URL(adminEmailEnvironmentValue("NEXT_PUBLIC_SITE_URL"));
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/"
      || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    return url;
  } catch { return null; }
}
export function getAdminEmailDeliveryConfiguration() {
  const enabled = adminEmailEnvironmentValue("ADMIN_EMAIL_SENDING_ENABLED") === "true";
  const from = adminEmailEnvironmentValue("RESEND_FROM_EMAIL");
  const address = (from.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] ?? from).trim();
  const missing = [
    ...(!enabled ? ["ADMIN_EMAIL_SENDING_ENABLED=true"] : []),
    ...(getPlatformConfiguration().mode !== "connected" ? ["connected platform"] : []),
    ...(!adminEmailEnvironmentValue("RESEND_API_KEY") ? ["RESEND_API_KEY"] : []),
    ...(!adminEmailEnvironmentValue("CRON_SECRET") ? ["CRON_SECRET"] : []),
    ...(!isAdminEmailAddress(address) || /[\r\n]/.test(from) ? ["RESEND_FROM_EMAIL"] : []),
    ...(!getAdminEmailSiteUrl() ? ["NEXT_PUBLIC_SITE_URL"] : []),
  ];
  const postalAddress = adminEmailEnvironmentValue("ADMIN_EMAIL_POSTAL_ADDRESS");
  const marketingMissing = [
    ...missing,
    ...(adminEmailEnvironmentValue("RESEND_MARKETING_ENABLED") !== "true" ? ["RESEND_MARKETING_ENABLED=true"] : []),
    ...(!adminEmailEnvironmentValue("RESEND_TOPIC_UPDATES_ID") ? ["RESEND_TOPIC_UPDATES_ID"] : []),
    ...(!postalAddress || postalAddress.length > 500 ? ["ADMIN_EMAIL_POSTAL_ADDRESS"] : []),
  ];
  return { enabled, ready: missing.length === 0, missing, marketingReady: marketingMissing.length === 0, marketingMissing };
}
