import "server-only";

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

export type PersonEmailSource =
  | "event"
  | "member_onboarding"
  | "membership"
  | "ops_import"
  | "platform_auth"
  | "shopify";

export class PersonIdentityConflictError extends Error {
  constructor() {
    super("That verified email is already linked to a different Ruined identity.");
    this.name = "PersonIdentityConflictError";
  }
}

type IdentityTransaction = postgres.TransactionSql;

export async function ensurePersonForEmail(
  tx: IdentityTransaction,
  input: {
    email: string;
    emailNormalized: string;
    preferredPersonId?: string | null;
    source: PersonEmailSource;
    verified: boolean;
  },
): Promise<string> {
  const existingRows = await tx<Array<{ person_id: string }>>`
    select person_id
    from person_email_addresses
    where email_normalized = ${input.emailNormalized}
      and retired_at is null
    limit 1
    for update
  `;
  const existing = existingRows[0];

  if (existing) {
    if (input.preferredPersonId && existing.person_id !== input.preferredPersonId) {
      throw new PersonIdentityConflictError();
    }

    if (input.verified) {
      await tx`
        update person_email_addresses
        set
          email = ${input.email.trim()},
          verification_state = 'verified',
          verified_at = coalesce(verified_at, statement_timestamp()),
          updated_at = statement_timestamp()
        where email_normalized = ${input.emailNormalized}
          and person_id = ${existing.person_id}::uuid
          and retired_at is null
      `;
    }

    return existing.person_id;
  }

  const personId = input.preferredPersonId ?? randomUUID();
  await tx`
    insert into people (id)
    values (${personId}::uuid)
    on conflict (id) do nothing
  `;

  const primaryRows = await tx<Array<{ has_primary: boolean }>>`
    select exists (
      select 1
      from person_email_addresses
      where person_id = ${personId}::uuid
        and is_primary = true
        and retired_at is null
    ) as has_primary
  `;

  const insertedRows = await tx<Array<{ person_id: string }>>`
    insert into person_email_addresses (
      person_id,
      email,
      email_normalized,
      verification_state,
      verified_at,
      source,
      is_primary
    ) values (
      ${personId}::uuid,
      ${input.email.trim()},
      ${input.emailNormalized},
      ${input.verified ? "verified" : "unverified"},
      ${input.verified ? new Date() : null},
      ${input.source},
      ${!primaryRows[0]?.has_primary}
    )
    returning person_id
  `;
  const inserted = insertedRows[0];
  if (!inserted) throw new Error("The Ruined identity could not be created.");
  return inserted.person_id;
}

export async function markPersonEmailVerified(
  tx: IdentityTransaction,
  input: {
    email: string;
    emailNormalized: string;
    personId: string;
  },
): Promise<void> {
  const personId = await ensurePersonForEmail(tx, {
    ...input,
    preferredPersonId: input.personId,
    source: "platform_auth",
    verified: true,
  });

  // Public forms are deliberately linked only after Supabase has verified the
  // same email for this Person. This preserves one history without guessing.
  await tx`
    update communication_contacts
    set person_id = ${personId}::uuid, updated_at = statement_timestamp()
    where email_normalized = ${input.emailNormalized}
      and person_id is null
  `;
  await tx`
    update community_event_registrations
    set person_id = ${personId}::uuid, updated_at = statement_timestamp()
    where email_normalized = ${input.emailNormalized}
      and person_id is null
  `;
}
