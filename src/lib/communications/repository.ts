import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type postgres from "postgres";

import { getApplicationDatabase } from "@/lib/database/server";
import {
  COMMUNICATION_SOURCES,
  EMAIL_CONSENT_NOTICES,
  EMAIL_CONSENT_VERSION,
  GENERAL_COMMUNICATION_SOURCE,
  normalizeCommunicationEmail,
  type CommunicationSource,
} from "@/lib/communications/model";

export type CommunicationConfirmationResult =
  | "confirmed"
  | "already_confirmed"
  | "invalid"
  | "expired";

export type ResendTopicPreference = "opt_in" | "opt_out";

const CONFIRMATION_LIFETIME_HOURS = 72;
const CONFIRMATION_RESEND_COOLDOWN_MINUTES = 15;
const SIGNUP_ATTEMPTS_PER_HOUR = 8;
const RESEND_SYNC_LEASE_MINUTES = 10;

function hashConfirmationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function consumeCommunicationSignupRateLimit(
  fingerprintHash: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(fingerprintHash)) return false;

  const sql = getApplicationDatabase();
  const rows = await sql<Array<{ attempts: number }>>`
    with cleanup as (
      delete from communication_signup_rate_limits
      where window_started_at < now() - interval '48 hours'
    )
    insert into communication_signup_rate_limits (
      fingerprint_hash,
      window_started_at,
      attempts
    ) values (
      ${fingerprintHash},
      date_trunc('hour', now()),
      1
    )
    on conflict (fingerprint_hash, window_started_at) do update
    set
      attempts = communication_signup_rate_limits.attempts + 1,
      updated_at = now()
    where communication_signup_rate_limits.attempts < ${SIGNUP_ATTEMPTS_PER_HOUR}
    returning attempts
  `;

  return rows.length > 0;
}

export async function subscribeToGeneralUpdates(emailValue: string): Promise<void> {
  const sql = getApplicationDatabase();
  const email = normalizeCommunicationEmail(emailValue);
  const source = GENERAL_COMMUNICATION_SOURCE;
  const notice = EMAIL_CONSENT_NOTICES[source];
  const confirmationToken = randomBytes(32).toString("base64url");
  const confirmationTokenHash = hashConfirmationToken(confirmationToken);

  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${email}), 3)`;

    const contacts = await tx<Array<{ id: string }>>`
      insert into communication_contacts (email_normalized)
      values (${email})
      on conflict (email_normalized) do update
      set updated_at = now()
      returning id
    `;
    const contact = contacts[0];
    if (!contact) throw new Error("Communication contact could not be stored.");

    const currentRows = await tx<Array<{
      id: string;
      status: "pending_confirmation" | "subscribed" | "unsubscribed";
      version: string;
      requestedAt: Date;
    }>>`
      select
        id,
        status,
        version::text,
        requested_at as "requestedAt"
      from communication_subscriptions
      where contact_id = ${contact.id}::uuid
        and channel = 'email'
        and topic = ${source}
      limit 1
      for update
    `;
    const current = currentRows[0];

    if (current?.status === "subscribed") {
      return;
    }
    if (
      current?.status === "pending_confirmation"
      && current.requestedAt.getTime()
        > Date.now() - CONFIRMATION_RESEND_COOLDOWN_MINUTES * 60_000
    ) return;

    const subscriptionRows = current
      ? await tx<Array<{ id: string; version: string }>>`
          update communication_subscriptions
          set
            status = 'pending_confirmation',
            consent_version = ${EMAIL_CONSENT_VERSION},
            last_state_source = ${source},
            requested_at = now(),
            confirmed_at = null,
            unsubscribed_at = null,
            version = version + 1,
            state_changed_at = now(),
            updated_at = now()
          where id = ${current.id}::uuid
          returning id, version::text
        `
      : await tx<Array<{ id: string; version: string }>>`
          insert into communication_subscriptions (
            contact_id,
            channel,
            topic,
            status,
            consent_version,
            last_state_source,
            requested_at
          ) values (
            ${contact.id}::uuid,
            'email',
            ${source},
            'pending_confirmation',
            ${EMAIL_CONSENT_VERSION},
            ${source},
            now()
          )
          returning id, version::text
        `;
    const subscription = subscriptionRows[0];
    if (!subscription) throw new Error("Communication subscription could not be stored.");

    await tx`
      insert into communication_confirmation_tokens (
        subscription_id,
        subscription_version,
        token_hash,
        expires_at
      ) values (
        ${subscription.id}::uuid,
        ${subscription.version}::bigint,
        ${confirmationTokenHash},
        now() + (${CONFIRMATION_LIFETIME_HOURS} * interval '1 hour')
      )
      on conflict (subscription_id, subscription_version) do nothing
    `;

    await tx`
      insert into communication_consent_events (
        subscription_id,
        decision,
        consent_version,
        source,
        evidence
      ) values (
        ${subscription.id}::uuid,
        'pending_confirmation',
        ${EMAIL_CONSENT_VERSION},
        ${source},
        jsonb_build_object(
          'affirmative_action', 'required_checkbox',
          'notice', ${notice}::text
        )
      )
    `;

    await tx`
      insert into integration_outbox (
        destination,
        event_type,
        aggregate_type,
        aggregate_id,
        dedupe_key,
        payload
      ) values (
        'resend',
        'communication.confirmation.requested',
        'communication_subscription',
        ${subscription.id},
        ${`resend:communication-subscription:${subscription.id}:v${subscription.version}`},
        jsonb_build_object(
          'contact_id', ${contact.id}::text,
          'topic', ${source}::text,
          'status', 'pending_confirmation',
          'subscription_version', ${subscription.version}::bigint,
          'confirmation_token', ${confirmationToken}::text
        )
      )
      on conflict (dedupe_key) do nothing
    `;
  });
}

export async function confirmCommunicationSubscription(
  token: string,
): Promise<CommunicationConfirmationResult> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return "invalid";

  const sql = getApplicationDatabase();
  const tokenHash = hashConfirmationToken(token);

  return sql.begin(async (tx) => {
    const rows = await tx<Array<{
      tokenId: string;
      subscriptionId: string;
      contactId: string;
      topic: CommunicationSource;
      status: "pending_confirmation" | "subscribed" | "unsubscribed";
      consentVersion: string;
      subscriptionVersion: string;
      tokenVersion: string;
      expiresAt: Date;
      consumedAt: Date | null;
    }>>`
      select
        token.id as "tokenId",
        subscription.id as "subscriptionId",
        subscription.contact_id as "contactId",
        subscription.topic,
        subscription.status,
        subscription.consent_version as "consentVersion",
        subscription.version::text as "subscriptionVersion",
        token.subscription_version::text as "tokenVersion",
        token.expires_at as "expiresAt",
        token.consumed_at as "consumedAt"
      from communication_confirmation_tokens token
      join communication_subscriptions subscription
        on subscription.id = token.subscription_id
      where token.token_hash = ${tokenHash}
      limit 1
      for update of token, subscription
    `;
    const record = rows[0];

    if (!record) return "invalid";
    if (record.status === "subscribed" && record.consumedAt) {
      return "already_confirmed";
    }
    if (record.expiresAt.getTime() <= Date.now()) return "expired";
    if (
      record.consumedAt
      || record.status !== "pending_confirmation"
      || record.subscriptionVersion !== record.tokenVersion
    ) {
      return "invalid";
    }

    const updatedRows = await tx<Array<{ version: string }>>`
      update communication_subscriptions
      set
        status = 'subscribed',
        confirmed_at = now(),
        unsubscribed_at = null,
        version = version + 1,
        state_changed_at = now(),
        updated_at = now()
      where id = ${record.subscriptionId}::uuid
        and status = 'pending_confirmation'
        and version = ${record.tokenVersion}::bigint
      returning version::text
    `;
    const updated = updatedRows[0];
    if (!updated) return "invalid";

    await tx`
      update communication_confirmation_tokens
      set consumed_at = now()
      where id = ${record.tokenId}::uuid
    `;

    await tx`
      insert into communication_consent_events (
        subscription_id,
        decision,
        consent_version,
        source,
        evidence
      ) values (
        ${record.subscriptionId}::uuid,
        'subscribed',
        ${record.consentVersion},
        ${record.topic},
        jsonb_build_object('affirmative_action', 'email_confirmation')
      )
    `;

    await tx`
      insert into integration_outbox (
        destination,
        event_type,
        aggregate_type,
        aggregate_id,
        dedupe_key,
        payload
      ) values (
        'resend',
        'communication.contact.sync_requested',
        'communication_contact',
        ${record.contactId},
        ${`resend:communication-contact:${record.contactId}:subscription:${record.subscriptionId}:v${updated.version}`},
        jsonb_build_object(
          'contact_id', ${record.contactId}::text,
          'subscription_version', ${updated.version}::bigint
        )
      )
      on conflict (dedupe_key) do nothing
    `;

    return "confirmed";
  });
}

async function insertWebhookReceipt(
  tx: postgres.TransactionSql,
  input: {
    svixId: string;
    eventType: string;
    externalObjectId?: string;
    eventCreatedAt: Date;
  },
): Promise<boolean> {
  const rows = await tx<Array<{ svixId: string }>>`
    insert into communication_webhook_events (
      svix_id,
      event_type,
      external_object_id,
      event_created_at
    ) values (
      ${input.svixId},
      ${input.eventType},
      ${input.externalObjectId ?? null},
      ${input.eventCreatedAt}
    )
    on conflict (svix_id) do nothing
    returning svix_id as "svixId"
  `;
  return rows.length > 0;
}

export async function applyResendContactPreferencesWebhook(input: {
  svixId: string;
  eventType: string;
  eventCreatedAt: Date;
  resendContactId: string;
  email: string;
  globallyUnsubscribed: boolean;
  topics: Partial<Record<CommunicationSource, ResendTopicPreference>>;
}): Promise<"processed" | "duplicate" | "unknown_contact"> {
  const sql = getApplicationDatabase();
  const email = normalizeCommunicationEmail(input.email);

  return sql.begin(async (tx) => {
    const inserted = await insertWebhookReceipt(tx, {
      svixId: input.svixId,
      eventType: input.eventType,
      externalObjectId: input.resendContactId,
      eventCreatedAt: input.eventCreatedAt,
    });
    if (!inserted) return "duplicate";

    const contacts = await tx<Array<{
      id: string;
      resendPreferencesSnapshot: Partial<Record<CommunicationSource, ResendTopicPreference>> | null;
      resendPreferencesSyncedAt: Date | null;
      resendSyncActive: boolean;
      resendSyncSnapshot: Partial<Record<CommunicationSource, ResendTopicPreference>> | null;
      resendSyncStartedAt: Date | null;
    }>>`
      select
        id,
        resend_preferences_snapshot as "resendPreferencesSnapshot",
        resend_preferences_synced_at as "resendPreferencesSyncedAt",
        resend_sync_started_at as "resendSyncStartedAt",
        (
          resend_sync_started_at >= now()
            - (${RESEND_SYNC_LEASE_MINUTES} * interval '1 minute')
        ) as "resendSyncActive",
        resend_sync_snapshot as "resendSyncSnapshot"
      from communication_contacts
      where resend_contact_id = ${input.resendContactId}
         or email_normalized = ${email}
      order by (resend_contact_id = ${input.resendContactId}) desc
      limit 1
      for update
    `;
    const contact = contacts[0];
    if (!contact) return "unknown_contact";

    if (contact.resendSyncStartedAt && !contact.resendSyncActive) {
      await tx`
        update communication_contacts
        set
          resend_sync_started_at = null,
          resend_sync_locked_by = null,
          resend_sync_snapshot = null,
          updated_at = now()
        where id = ${contact.id}::uuid
          and resend_sync_started_at = ${contact.resendSyncStartedAt}
      `;
    }

    await tx`
      update communication_contacts
      set resend_contact_id = ${input.resendContactId}, updated_at = now()
      where id = ${contact.id}::uuid
    `;
    const matchesLastAppSync = !input.globallyUnsubscribed
      && Boolean(contact.resendPreferencesSnapshot)
      && COMMUNICATION_SOURCES.every(
        (topic) => input.topics[topic] === contact.resendPreferencesSnapshot?.[topic],
      );
    if (
      matchesLastAppSync
      && contact.resendPreferencesSyncedAt
      && input.eventCreatedAt.getTime() <= contact.resendPreferencesSyncedAt.getTime()
    ) return "processed";
    const matchesActiveAppSync = contact.resendSyncActive
      && !input.globallyUnsubscribed
      && Boolean(contact.resendSyncSnapshot)
      && COMMUNICATION_SOURCES.every(
        (topic) => input.topics[topic] === contact.resendSyncSnapshot?.[topic],
      );
    if (matchesActiveAppSync) return "processed";

    const subscriptions = await tx<Array<{
      id: string;
      topic: CommunicationSource;
      status: "pending_confirmation" | "subscribed" | "unsubscribed";
      consentVersion: string;
      stateChangedAt: Date;
    }>>`
      select
        id,
        topic,
        status,
        consent_version as "consentVersion",
        state_changed_at as "stateChangedAt"
      from communication_subscriptions
      where contact_id = ${contact.id}::uuid
      for update
    `;

    let consentChanged = false;
    const canonicalPreferences = new Map(
      subscriptions.map((subscription) => [
        subscription.topic,
        subscription.status === "subscribed" ? "opt_in" : "opt_out",
      ] as const),
    );
    const syncCorrectionRequired = COMMUNICATION_SOURCES.some((topic) => {
      const resendPreference = input.topics[topic];
      return Boolean(
        resendPreference
        && resendPreference !== (canonicalPreferences.get(topic) ?? "opt_out"),
      );
    });
    for (const subscription of subscriptions) {
      const topicPreference = input.topics[subscription.topic];
      // Resend is the delivery preference surface, not the consent authority.
      // It may revoke consent, but only the Ruined email-confirmation flow may
      // create or restore it.
      const desired = input.globallyUnsubscribed || topicPreference === "opt_out"
        ? "unsubscribed"
        : subscription.status;

      if (
        desired === subscription.status
        || input.eventCreatedAt.getTime() < subscription.stateChangedAt.getTime()
      ) continue;

      await tx`
        update communication_subscriptions
        set
          status = ${desired},
          confirmed_at = confirmed_at,
          unsubscribed_at = case
            when ${desired} = 'unsubscribed' then ${input.eventCreatedAt}
            else null
          end,
          last_state_source = 'resend',
          version = version + 1,
          state_changed_at = ${input.eventCreatedAt},
          updated_at = now()
        where id = ${subscription.id}::uuid
      `;
      consentChanged = true;

      await tx`
        insert into communication_consent_events (
          subscription_id,
          decision,
          consent_version,
          source,
          evidence,
          occurred_at
        ) values (
          ${subscription.id}::uuid,
          ${desired},
          ${subscription.consentVersion},
          'resend',
          jsonb_build_object(
            'action', 'resend_preference_revocation',
            'global_unsubscribe', ${input.globallyUnsubscribed}
          ),
          ${input.eventCreatedAt}
        )
      `;
    }

    if (consentChanged || syncCorrectionRequired) {
      await tx`
        insert into integration_outbox (
          destination,
          event_type,
          aggregate_type,
          aggregate_id,
          dedupe_key,
          payload
        ) values (
          'resend',
          'communication.contact.sync_requested',
          'communication_contact',
          ${contact.id},
          ${`resend:communication-contact:${contact.id}:preference-webhook:${input.svixId}`},
          jsonb_build_object(
            'contact_id', ${contact.id}::text,
            'source_webhook_id', ${input.svixId}::text
          )
        )
        on conflict (dedupe_key) do nothing
      `;
    }

    return "processed";
  });
}

export async function applyResendDeliveryWebhook(input: {
  svixId: string;
  eventType: string;
  eventCreatedAt: Date;
  externalObjectId?: string;
  email: string;
  deliveryState: "active" | "bounced" | "complained" | "suppressed";
  withdrawConsent: boolean;
}): Promise<"processed" | "duplicate" | "unknown_contact"> {
  const sql = getApplicationDatabase();
  const email = normalizeCommunicationEmail(input.email);

  return sql.begin(async (tx) => {
    const inserted = await insertWebhookReceipt(tx, {
      svixId: input.svixId,
      eventType: input.eventType,
      externalObjectId: input.externalObjectId,
      eventCreatedAt: input.eventCreatedAt,
    });
    if (!inserted) return "duplicate";

    const contacts = await tx<Array<{
      id: string;
      deliveryStateUpdatedAt: Date | null;
    }>>`
      select
        id,
        delivery_state_updated_at as "deliveryStateUpdatedAt"
      from communication_contacts
      where email_normalized = ${email}
      limit 1
      for update
    `;
    const contact = contacts[0];
    if (!contact) return "unknown_contact";
    const deliveryEventIsCurrent = !contact.deliveryStateUpdatedAt
      || contact.deliveryStateUpdatedAt.getTime() <= input.eventCreatedAt.getTime();
    if (deliveryEventIsCurrent) {
      await tx`
        update communication_contacts
        set
          delivery_state = ${input.deliveryState},
          delivery_state_updated_at = ${input.eventCreatedAt},
          updated_at = now()
        where id = ${contact.id}::uuid
      `;
    }
    if (!input.withdrawConsent) return "processed";

    const subscriptions = await tx<Array<{
      id: string;
      consentVersion: string;
    }>>`
      update communication_subscriptions
      set
        status = 'unsubscribed',
        unsubscribed_at = ${input.eventCreatedAt},
        last_state_source = 'resend',
        version = version + 1,
        state_changed_at = ${input.eventCreatedAt},
        updated_at = now()
      where contact_id = ${contact.id}::uuid
        and status <> 'unsubscribed'
        and state_changed_at <= ${input.eventCreatedAt}
      returning id, consent_version as "consentVersion"
    `;

    for (const subscription of subscriptions) {
      await tx`
        insert into communication_consent_events (
          subscription_id,
          decision,
          consent_version,
          source,
          evidence,
          occurred_at
        ) values (
          ${subscription.id}::uuid,
          'unsubscribed',
          ${subscription.consentVersion},
          'resend',
          jsonb_build_object('delivery_event', ${input.eventType}),
          ${input.eventCreatedAt}
        )
      `;
    }

    if (subscriptions.length > 0) {
      await tx`
        insert into integration_outbox (
          destination,
          event_type,
          aggregate_type,
          aggregate_id,
          dedupe_key,
          payload
        ) values (
          'resend',
          'communication.contact.sync_requested',
          'communication_contact',
          ${contact.id},
          ${`resend:communication-contact:${contact.id}:delivery-webhook:${input.svixId}`},
          jsonb_build_object(
            'contact_id', ${contact.id}::text,
            'source_webhook_id', ${input.svixId}::text
          )
        )
        on conflict (dedupe_key) do nothing
      `;
    }

    return "processed";
  });
}
