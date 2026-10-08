import "server-only";

import twilio from "twilio";
import { readMemberSmsConfiguration } from "./member-sms-config";
import type { MemberSmsInbound } from "./member-sms-model";

const stopKeywords = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"]);

/** Use Twilio's validator with the configured external URL, never proxy/Host headers. */
export function verifyMemberSmsInbound(rawBody: string, signature: string | null): MemberSmsInbound {
  const config = readMemberSmsConfiguration();
  if (!config.webhookReady || !config.inboundUrl || !signature) throw new Error("Invalid SMS webhook.");
  const params: Record<string, string> = Object.create(null);
  for (const [key, value] of new URLSearchParams(rawBody)) {
    if (Object.hasOwn(params, key)) throw new Error("Invalid SMS webhook.");
    params[key] = value;
  }
  if (!twilio.validateRequest(config.authToken, signature, config.inboundUrl, params)
    || params.AccountSid !== config.accountSid || params.To !== config.phoneNumber
    || (params.MessagingServiceSid && params.MessagingServiceSid !== config.messagingServiceSid)
    || !/^SM[0-9a-f]{32}$/i.test(params.MessageSid ?? "")
    || !/^[+][1-9][0-9]{1,14}$/.test(params.From ?? "")) {
    throw new Error("Invalid SMS webhook.");
  }
  const keyword = (params.Body ?? "").trim().toUpperCase();
  const type = params.OptOutType;
  const kind: MemberSmsInbound["kind"] = type === "STOP" || stopKeywords.has(keyword) ? "STOP"
    : type === "HELP" || keyword === "HELP" || keyword === "INFO" ? "HELP"
      : type === "START" || ["START", "UNSTOP", "YES"].includes(keyword) ? "START" : "message";
  return { messageSid: params.MessageSid, phone: params.From, kind };
}
