import "server-only";

import { getApplicationDatabase } from "@/lib/database/server";
import {
  BYOB_02_EVENT_KEY,
  BYOB_02_WAIVER_BODY,
  BYOB_02_WAIVER_SHA256,
  BYOB_02_WAIVER_TITLE,
  BYOB_02_WAIVER_VERSION,
  type Byob02RegistrationSubmission,
} from "@/lib/events/byob-registration-model";

const REGISTRATION_ATTEMPTS_PER_HOUR = 8;

export async function consumeByobRegistrationRateLimit(
  fingerprintHash: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(fingerprintHash)) return false;

  const sql = getApplicationDatabase();
  const rows = await sql<Array<{ attempts: number }>>`
    with cleanup as (
      delete from community_event_registration_rate_limits
      where window_started_at < now() - interval '48 hours'
    )
    insert into community_event_registration_rate_limits (
      event_key,
      fingerprint_hash,
      window_started_at,
      attempts
    ) values (
      ${BYOB_02_EVENT_KEY},
      ${fingerprintHash},
      date_trunc('hour', now()),
      1
    )
    on conflict (event_key, fingerprint_hash, window_started_at) do update
    set
      attempts = community_event_registration_rate_limits.attempts + 1,
      updated_at = now()
    where community_event_registration_rate_limits.attempts
      < ${REGISTRATION_ATTEMPTS_PER_HOUR}
    returning attempts
  `;

  return rows.length > 0;
}

export async function registerByob02Participant(
  submission: Byob02RegistrationSubmission,
): Promise<void> {
  const sql = getApplicationDatabase();

  await sql.begin(async (tx) => {
    await tx`
      select pg_advisory_xact_lock(
        hashtext(${BYOB_02_EVENT_KEY}),
        hashtext(${submission.emailNormalized})
      )
    `;

    const waiverRows = await tx<Array<{
      body: string;
      contentSha256: string;
      title: string;
    }>>`
      select
        title,
        body,
        content_sha256 as "contentSha256"
      from community_event_waiver_versions
      where event_key = ${BYOB_02_EVENT_KEY}
        and version = ${BYOB_02_WAIVER_VERSION}
      limit 1
    `;
    const waiver = waiverRows[0];

    if (
      !waiver ||
      waiver.title !== BYOB_02_WAIVER_TITLE ||
      waiver.body !== BYOB_02_WAIVER_BODY ||
      waiver.contentSha256 !== BYOB_02_WAIVER_SHA256
    ) {
      throw new Error("BYOB Nº 02 waiver is not configured.");
    }

    const registrationRows = await tx<Array<{ id: string }>>`
      insert into community_event_registrations (
        event_key,
        registrant_name,
        registrant_first_name,
        registrant_last_name,
        email_normalized,
        instagram_handle,
        waiver_version,
        waiver_accepted_at,
        waiver_acceptance_evidence
      ) values (
        ${BYOB_02_EVENT_KEY},
        ${submission.registrantName},
        ${submission.registrantFirstName},
        ${submission.registrantLastName},
        ${submission.emailNormalized},
        ${submission.instagramHandle},
        ${submission.waiverVersion},
        now(),
        jsonb_build_object(
          'affirmative_action', 'required_checkbox',
          'scope', 'registrant_only',
          'participant', 'registrant',
          'age_confirmation', '18_or_older',
          'carpool_disclosure_presented', true,
          'waiver_sha256', ${BYOB_02_WAIVER_SHA256}::text
        )
      )
      on conflict (event_key, email_normalized) do nothing
      returning id
    `;
    const registration = registrationRows[0];

    // A repeated submission must not reveal that the address already exists or
    // let anyone who knows an email address replace the stored acknowledgment.
    if (!registration) return;
  });
}
