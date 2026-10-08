import "server-only";

export const MEMBER_SMS_STATUS_PATH = "/api/twilio/status";
export const MEMBER_SMS_INBOUND_PATH = "/api/twilio/inbound";
export const MEMBER_SMS_HELP_MESSAGE = "Ruined membership reminders: For help, email connect@theruinedproject.com. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe.";

function configuredOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "members.theruinedproject.com" || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return url.origin;
  } catch { return null; }
}

/** Server-only configuration. Never log this object: it includes the auth token. */
export function readMemberSmsConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const value = (key: string) => env[key]?.trim() ?? "";
  const accountSid = value("TWILIO_ACCOUNT_SID");
  const authToken = value("TWILIO_AUTH_TOKEN");
  const phoneNumber = value("TWILIO_PHONE_NUMBER");
  const messagingServiceSid = value("TWILIO_MESSAGING_SERVICE_SID");
  const publicOrigin = configuredOrigin(value("TWILIO_WEBHOOK_BASE_URL"));
  const webhookReady = /^AC[0-9a-f]{32}$/i.test(accountSid) && authToken.length > 0
    && /^[+][1-9][0-9]{1,14}$/.test(phoneNumber) && Boolean(publicOrigin);
  return {
    enabled: value("MEMBER_SMS_ENABLED") === "true",
    accountSid, authToken, phoneNumber, messagingServiceSid, publicOrigin,
    statusUrl: publicOrigin ? `${publicOrigin}${MEMBER_SMS_STATUS_PATH}` : null,
    inboundUrl: publicOrigin ? `${publicOrigin}${MEMBER_SMS_INBOUND_PATH}` : null,
    webhookReady,
    sendReady: webhookReady && /^MG[0-9a-f]{32}$/i.test(messagingServiceSid),
  };
}

export function getMemberSmsConfigurationStatus() {
  const config = readMemberSmsConfiguration();
  return { enabled: config.enabled, sendReady: config.sendReady, webhookReady: config.webhookReady };
}
