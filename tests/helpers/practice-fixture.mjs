import { readFile } from 'node:fs/promises';
import * as crypto from 'node:crypto';
import { timelineFixture, timelineIds } from './canonical-journal-fixture.mjs';

export const ids = timelineIds;
const source = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

export async function practiceFixture(t, { beforeMigration, launched = true, publicTimelineMigration = true } = {}) {
  const f = await timelineFixture(t);
  await f.db.exec(`
    alter table ruined_members add column if not exists deleted_at timestamptz;
    create table member_badge_awards(member_id uuid not null references ruined_members(id),badge_key text not null,
      earned_at timestamptz not null,source_event_id text not null,source_invoice_id text,rule_version integer not null,
      public_visible boolean not null default true,acknowledged_at timestamptz,primary key(member_id,badge_key));
    create function private.ruined_member_badge_progress(target_member_id uuid)
    returns table(badge_key text,progress integer,target integer,earned_at timestamptz,source_event_id text)
    language sql stable as $$
      select 'your-story'::text,count(*)::integer,1,min(completed_at),'foundation-requirement:' || min(id::text)
      from public.member_foundation_requirement_completions where member_id = target_member_id and requirement_slug='timeline' and state='completed'
      union all select 'unrelated-badge',0,1,null::timestamptz,null::text
    $$;
  `);
  if (beforeMigration) await beforeMigration(f);
  await f.db.exec(await source('db/migrations/20261104180000_member_practice.sql'));
  if (publicTimelineMigration) await f.db.exec(await source('db/migrations/20261106010000_practice_public_timeline.sql'));
  const releaseSchedule = (await f.db.query('select course,release_at from member_practice_releases order by course')).rows;
  // The release contract is inspected above; mutation scenarios stay deterministic after December.
  await f.db.query("update member_practice_releases set release_at=statement_timestamp()+interval '1 day' where course='time'");
  const model = await f.loadTypescript('src/lib/practice/model.ts');
  const access = await f.loadTypescript('src/lib/membership/access-policy.ts');
  const journal = await f.loadTypescript('src/lib/membership/journal-repository.ts', {
    'server-only': {}, 'node:crypto': crypto, '@/lib/database/server': { getApplicationDatabase: () => f.sql },
    '@/lib/membership/repository': f.repository, '@/lib/membership/access-policy': access,
    './journal-model': await f.loadTypescript('src/lib/membership/journal-model.ts'),
    './journal-storage': { journalStorageConfigured: () => false },
    './public-card-repository': { getOwnMemberProfilePublicScope: async () => ({ token: 'test-profile' }) },
  });
  const badgeModel = await f.loadTypescript('src/lib/membership/badge-model.ts', {
    './member-number': await f.loadTypescript('src/lib/membership/member-number.ts'),
  });
  const badges = await f.loadTypescript('src/lib/membership/badge-repository.ts', {
    'server-only': {}, '@/lib/database/server': { getApplicationDatabase: () => f.sql }, './badge-model': badgeModel,
  });
  const practice = await f.loadTypescript('src/lib/practice/repository.ts', {
    'server-only': {}, '@/lib/database/server': { getApplicationDatabase: () => f.sql },
    '@/lib/foundations/availability': { isFoundationsAvailableToMember: async () => launched, isFoundationsLaunched: () => launched },
    '@/lib/membership/access-policy': access, '@/lib/membership/badge-repository': badges,
    '@/lib/membership/repository': f.repository, './model': model,
  });
  const open = course => f.db.query("update member_practice_releases set release_at = statement_timestamp() - interval '1 minute' where course=$1", [course]);
  return { ...f, model, practice, journal, open, releaseSchedule,
    get: (auth = ids.auth) => practice.getMemberPracticeSnapshot(auth),
    save: (action, fields, revision, extra = {}) => practice.saveMemberPractice(ids.auth, { action, ownerId: ids.auth, expectedRevision: revision, fields, ...extra }),
  };
}
