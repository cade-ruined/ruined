begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- The profile form is not the only phone writer. Operator corrections, older
-- clients, and direct private-profile writes must retire the old SMS choice too.
-- Keep the original evidence: returning to an earlier number never revives it.
create function private.ruined_invalidate_sms_consent_on_phone_change() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare
  prior_person uuid;
  next_person uuid;
  next_phone text;
  consent_row record;
begin
  if tg_op <> 'INSERT' then prior_person := old.person_id; end if;
  if tg_op <> 'DELETE' then
    next_person := new.person_id;
    next_phone := new.mobile_e164;
  end if;
  if tg_op = 'UPDATE' and new.person_id is not distinct from old.person_id
    and new.mobile_e164 is not distinct from old.mobile_e164 then
    return new;
  end if;

  for consent_row in
    select latest.*, member.person_id
    from public.ruined_members member
    cross join lateral (
      select consent.id,consent.member_id,consent.policy_version,consent.decision,consent.source,
        consent.actor_auth_user_id,consent.evidence,consent.xmin::text as inserted_transaction
      from public.member_consents consent
      where consent.member_id=member.id and consent.consent_type='communications'
        and consent.evidence->>'context'='member_communication_preferences_v1'
        and consent.evidence->>'purpose'='membership_updates'
        and consent.evidence->>'channel'='sms'
      order by consent.id desc limit 1
    ) latest
    where member.person_id=prior_person or member.person_id=next_person
  loop
    if consent_row.decision <> 'accepted' then continue; end if;

    -- The member flow writes consent before its profile upsert. Only an actual
    -- member checkbox decision inserted in this same transaction may authorize
    -- the new number. Merely finding an old acceptance for NEW is insufficient.
    -- The uint32 comparison matches PostgreSQL's xmin across transaction epochs.
    if consent_row.person_id=next_person and next_phone is not null
      and consent_row.evidence->>'destination'=next_phone
      and consent_row.source='member' and consent_row.actor_auth_user_id is not null
      and consent_row.evidence->>'action'='sms_checkbox_checked'
      and consent_row.evidence->>'requested'='true'
      and consent_row.inserted_transaction=(txid_current() % 4294967296)::text then
      continue;
    end if;

    insert into public.member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,evidence,dedupe_key)
    values(consent_row.member_id,'communications',consent_row.policy_version,'withdrawn',statement_timestamp(),'ops',
      jsonb_build_object(
        'context','member_communication_preferences_v1','purpose','membership_updates','channel','sms',
        'destination',consent_row.evidence->>'destination','requested',false,'marketingConsent',false,
        'action','profile_phone_changed','generatedBy','database_trigger','profileOperation',lower(tg_op),
        'invalidatedConsentId',consent_row.id::text),
      'member-sms-phone-change:' || consent_row.id::text)
    on conflict(dedupe_key) do nothing;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

revoke all on function private.ruined_invalidate_sms_consent_on_phone_change() from public,anon,authenticated;
create trigger person_private_profile_sms_phone_change
  after insert or update of mobile_e164,person_id or delete on public.person_private_profiles
  for each row execute function private.ruined_invalidate_sms_consent_on_phone_change();

commit;
