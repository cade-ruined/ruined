import "server-only";

import { Resend, type ErrorResponse, type WebhookEventPayload } from "resend";

import { createGeneralUpdatesConfirmationEmail } from "@/lib/communications/general-updates-confirmation-email";
import {
  COMMUNICATION_SOURCES,
  normalizeCommunicationEmail,
  type CommunicationSource,
} from "@/lib/communications/model";

export type ResendTopic = CommunicationSource;
export type ResendTopicSubscription = "opt_in" | "opt_out";

export type ResendContactTopicState = {
  id: string;
  name: string;
  subscription: ResendTopicSubscription;
  topic: ResendTopic;
};

export type ResendContactPreferenceState = {
  contactId: string;
  email: string;
  globallyUnsubscribed: boolean;
  topics: ResendContactTopicState[];
};

export type ResendConfigurationStatus = {
  apiKeyConfigured: boolean;
  configured: boolean;
  confirmationEmailReady: boolean;
  contactSyncReady: boolean;
  fromEmailConfigured: boolean;
  marketingEnabled: boolean;
  missing: string[];
  siteUrlConfigured: boolean;
  topicsConfigured: Record<ResendTopic, boolean>;
  webhookSecretConfigured: boolean;
  webhookVerificationReady: boolean;
};

export type SendDoubleOptInConfirmationEmailInput = {
  email: string;
  idempotencyKey: string;
  token: string;
};

export type SendDoubleOptInConfirmationEmailResult = {
  confirmationUrl: string;
  emailId: string;
};

export type SendContactSubmissionInput = {
  email: string;
  idempotencyKey: string;
  message: string;
  name: string;
};

export type SendContactSubmissionResult = {
  emailId: string;
};

export type UpsertResendContactInput = {
  email: string;
  topics: Partial<Record<ResendTopic, ResendTopicSubscription>>;
};

export type UpsertResendContactResult = {
  contactId: string;
  topics: ResendContactTopicState[];
};

export type ResendWebhookHeaderSource =
  | Pick<Headers, "get">
  | Record<string, string | string[] | null | undefined>;

const TOPIC_ENVIRONMENT_VARIABLES: Record<ResendTopic, string> = {
  store: "RESEND_TOPIC_STORE_ID",
  artifacts: "RESEND_TOPIC_ARTIFACTS_ID",
  about: "RESEND_TOPIC_UPDATES_ID",
};

let resendClient: Resend | undefined;
let resendClientApiKey: string | undefined;

function environmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function getResendClient(): Resend {
  const apiKey = environmentValue("RESEND_API_KEY");
  if (!apiKey) {
    throw new Error("Resend is unavailable: RESEND_API_KEY is not configured.");
  }

  if (!resendClient || resendClientApiKey !== apiKey) {
    resendClient = new Resend(apiKey);
    resendClientApiKey = apiKey;
  }

  return resendClient;
}

function requireMarketingEnabled(): void {
  if (process.env.RESEND_MARKETING_ENABLED !== "true") {
    throw new Error("Resend marketing is disabled.");
  }
}

function requireEnvironmentValue(name: string): string {
  const value = environmentValue(name);
  if (!value) {
    throw new Error(`Resend is unavailable: ${name} is not configured.`);
  }
  return value;
}

function requireEmail(value: string): string {
  const email = normalizeCommunicationEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid email address is required.");
  }
  return email;
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requireProductionSiteUrl(): URL {
  const configuredUrl = requireEnvironmentValue("NEXT_PUBLIC_SITE_URL");
  let url: URL;

  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an absolute URL.");
  }

  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("NEXT_PUBLIC_SITE_URL must use HTTPS outside local development.");
  }

  return url;
}

function resendFailure(operation: string, error: ErrorResponse): Error {
  const status = error.statusCode ? ` (${error.statusCode})` : "";
  return new Error(`Resend ${operation} failed${status}: ${error.message}`);
}

function isDuplicateContactError(error: ErrorResponse): boolean {
  const message = error.message.toLowerCase();
  return (
    error.statusCode === 409 ||
    message.includes("already exists") ||
    message.includes("already been added") ||
    message.includes("duplicate")
  );
}

function topicIdsByInternalTopic(): Record<ResendTopic, string | undefined> {
  return {
    store: environmentValue(TOPIC_ENVIRONMENT_VARIABLES.store),
    artifacts: environmentValue(TOPIC_ENVIRONMENT_VARIABLES.artifacts),
    about: environmentValue(TOPIC_ENVIRONMENT_VARIABLES.about),
  };
}

function internalTopicById(): Map<string, ResendTopic> {
  const topicIds = topicIdsByInternalTopic();
  const entries = COMMUNICATION_SOURCES.flatMap((topic) => {
    const id = topicIds[topic];
    return id ? ([[id, topic]] as const) : [];
  });
  return new Map(entries);
}

function readWebhookHeader(headers: ResendWebhookHeaderSource, name: string): string | undefined {
  if ("get" in headers && typeof headers.get === "function") {
    return headers.get(name)?.trim() || undefined;
  }

  const target = name.toLowerCase();
  for (const [key, rawValue] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) continue;
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    return value?.trim() || undefined;
  }

  return undefined;
}

export function getResendConfigurationStatus(): ResendConfigurationStatus {
  const apiKeyConfigured = Boolean(environmentValue("RESEND_API_KEY"));
  const marketingEnabled = process.env.RESEND_MARKETING_ENABLED === "true";
  const fromEmailConfigured = Boolean(environmentValue("RESEND_FROM_EMAIL"));
  const siteUrlConfigured = Boolean(environmentValue("NEXT_PUBLIC_SITE_URL"));
  const webhookSecretConfigured = Boolean(environmentValue("RESEND_WEBHOOK_SECRET"));
  const topicIds = topicIdsByInternalTopic();
  const topicsConfigured: Record<ResendTopic, boolean> = {
    store: Boolean(topicIds.store),
    artifacts: Boolean(topicIds.artifacts),
    about: Boolean(topicIds.about),
  };
  const contactSyncReady =
    apiKeyConfigured &&
    marketingEnabled &&
    COMMUNICATION_SOURCES.every((topic) => topicsConfigured[topic]);
  const confirmationEmailReady =
    apiKeyConfigured && marketingEnabled && fromEmailConfigured && siteUrlConfigured;
  const webhookVerificationReady = apiKeyConfigured && webhookSecretConfigured;
  const missing = [
    ...(!apiKeyConfigured ? ["RESEND_API_KEY"] : []),
    ...(!marketingEnabled ? ["RESEND_MARKETING_ENABLED=true"] : []),
    ...(!fromEmailConfigured ? ["RESEND_FROM_EMAIL"] : []),
    ...(!siteUrlConfigured ? ["NEXT_PUBLIC_SITE_URL"] : []),
    ...COMMUNICATION_SOURCES.flatMap((topic) =>
      topicsConfigured[topic] ? [] : [TOPIC_ENVIRONMENT_VARIABLES[topic]],
    ),
    ...(!webhookSecretConfigured ? ["RESEND_WEBHOOK_SECRET"] : []),
  ];

  return {
    apiKeyConfigured,
    configured:
      confirmationEmailReady && contactSyncReady && webhookVerificationReady,
    confirmationEmailReady,
    contactSyncReady,
    fromEmailConfigured,
    marketingEnabled,
    missing,
    siteUrlConfigured,
    topicsConfigured,
    webhookSecretConfigured,
    webhookVerificationReady,
  };
}

export function getResendTopicId(topic: ResendTopic): string {
  return requireEnvironmentValue(TOPIC_ENVIRONMENT_VARIABLES[topic]);
}

export function isContactDeliveryConfigured(): boolean {
  return Boolean(
    environmentValue("RESEND_API_KEY") &&
    environmentValue("RESEND_FROM_EMAIL"),
  );
}

export async function sendContactSubmission(
  input: SendContactSubmissionInput,
): Promise<SendContactSubmissionResult> {
  const resend = getResendClient();
  const from = requireEnvironmentValue("RESEND_FROM_EMAIL");
  const to =
    environmentValue("CONTACT_TO_EMAIL") ??
    environmentValue("NEXT_PUBLIC_CONTACT_EMAIL") ??
    "connect@theruinedproject.com";
  const email = requireEmail(input.email);
  const name = requireNonEmpty(input.name, "Name");
  const message = requireNonEmpty(input.message, "Message");
  const idempotencyKey = requireNonEmpty(input.idempotencyKey, "Idempotency key");

  const response = await resend.emails.send(
    {
      from,
      to,
      replyTo: email,
      subject: "New contact message",
      text: [
        "New contact message for The Ruined Project",
        "",
        `Name: ${name}`,
        `Email: ${email}`,
        "",
        "Message:",
        message,
      ].join("\n"),
    },
    { idempotencyKey },
  );

  if (response.error) throw resendFailure("contact email", response.error);

  return { emailId: response.data.id };
}

export async function sendDoubleOptInConfirmationEmail(
  input: SendDoubleOptInConfirmationEmailInput,
): Promise<SendDoubleOptInConfirmationEmailResult> {
  requireMarketingEnabled();
  const resend = getResendClient();
  const from = requireEnvironmentValue("RESEND_FROM_EMAIL");
  const email = requireEmail(input.email);
  const token = requireNonEmpty(input.token, "Confirmation token");
  const idempotencyKey = requireNonEmpty(input.idempotencyKey, "Idempotency key");
  const siteUrl = requireProductionSiteUrl();
  const confirmationUrl = new URL("/communications/confirm", siteUrl);
  confirmationUrl.searchParams.set("token", token);
  const confirmationUrlString = confirmationUrl.toString();
  const confirmationEmail = createGeneralUpdatesConfirmationEmail({
    confirmationUrl: confirmationUrlString,
    siteUrl,
  });

  const response = await resend.emails.send(
    {
      from,
      to: email,
      ...confirmationEmail,
    },
    { idempotencyKey },
  );

  if (response.error) throw resendFailure("confirmation email", response.error);

  return {
    confirmationUrl: confirmationUrlString,
    emailId: response.data.id,
  };
}

export async function upsertResendContact(
  input: UpsertResendContactInput,
): Promise<UpsertResendContactResult> {
  requireMarketingEnabled();
  const resend = getResendClient();
  const email = requireEmail(input.email);
  const topicUpdates = COMMUNICATION_SOURCES.flatMap((topic) => {
    const subscription = input.topics[topic];
    return subscription
      ? [{ id: getResendTopicId(topic), subscription }]
      : [];
  });

  if (topicUpdates.length === 0) {
    throw new Error("At least one Resend topic state is required.");
  }

  const createResponse = await resend.contacts.create({
    email,
    unsubscribed: false,
    topics: topicUpdates,
  });
  let contactId: string;
  let existingContact = false;

  if (createResponse.data) {
    contactId = createResponse.data.id;
  } else if (isDuplicateContactError(createResponse.error)) {
    const getResponse = await resend.contacts.get({ email });
    if (getResponse.error) throw resendFailure("contact lookup", getResponse.error);
    contactId = getResponse.data.id;
    existingContact = true;
  } else {
    throw resendFailure("contact creation", createResponse.error);
  }

  if (existingContact) {
    // A topic confirmation must never silently clear a separate global
    // unsubscribe or suppression. Existing contacts receive one atomic topic
    // update; global re-consent requires its own explicit product flow.
    const topicResponse = await resend.contacts.topics.update({
      id: contactId,
      topics: topicUpdates,
    });
    if (topicResponse.error) throw resendFailure("contact topic update", topicResponse.error);
  }

  return {
    contactId,
    topics: await listResendContactTopicStates(email),
  };
}

export async function getResendContactPreferenceState(
  emailInput: string,
): Promise<ResendContactPreferenceState> {
  requireMarketingEnabled();
  const resend = getResendClient();
  const email = requireEmail(emailInput);
  const [contactResponse, topics] = await Promise.all([
    resend.contacts.get({ email }),
    listResendContactTopicStates(email),
  ]);
  if (contactResponse.error) throw resendFailure("contact lookup", contactResponse.error);

  return {
    contactId: contactResponse.data.id,
    email: contactResponse.data.email,
    globallyUnsubscribed: contactResponse.data.unsubscribed,
    topics,
  };
}

export async function listResendContactTopicStates(
  emailInput: string,
): Promise<ResendContactTopicState[]> {
  requireMarketingEnabled();
  const resend = getResendClient();
  const email = requireEmail(emailInput);
  const response = await resend.contacts.topics.list({ email, limit: 100 });
  if (response.error) throw resendFailure("contact topic lookup", response.error);

  const knownTopics = internalTopicById();
  return response.data.data.flatMap((topicState) => {
    const topic = knownTopics.get(topicState.id);
    return topic
      ? [{
          id: topicState.id,
          name: topicState.name,
          subscription: topicState.subscription,
          topic,
        }]
      : [];
  });
}

export function verifyResendWebhook(
  rawBody: string,
  headers: ResendWebhookHeaderSource,
): WebhookEventPayload {
  if (!rawBody) throw new Error("Webhook raw body is required.");
  const webhookSecret = requireEnvironmentValue("RESEND_WEBHOOK_SECRET");
  const id = readWebhookHeader(headers, "svix-id");
  const timestamp = readWebhookHeader(headers, "svix-timestamp");
  const signature = readWebhookHeader(headers, "svix-signature");

  if (!id || !timestamp || !signature) {
    throw new Error("Resend webhook signature headers are incomplete.");
  }

  return getResendClient().webhooks.verify({
    payload: rawBody,
    headers: { id, timestamp, signature },
    webhookSecret,
  });
}
