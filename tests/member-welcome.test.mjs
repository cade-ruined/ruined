import assert from 'node:assert/strict';
import test from 'node:test';
import {
  badgeCollectionFixture, badgeId as id, badgeSql, loadBadgeModule as load, readBadgeSource as read,
} from './helpers/badge-collection-fixture.mjs';

const migrationName = '20261026211000_member_welcome_state.sql';
const migration = await read(`db/migrations/${migrationName}`);
const model = await load('src/lib/membership/welcome-model.ts');

async function fixture(t) {
  const f = await badgeCollectionFixture(t);
  await f.db.exec('create role service_role bypassrls');
  await f.db.exec(migration);
  const repository = () => load('src/lib/membership/welcome-repository.ts', {
    'server-only': {}, '@/lib/database/server': { getApplicationDatabase: () => badgeSql(f.db) },
    './badge-repository': f.repository, './welcome-model': model,
  });
  return { ...f, loadWelcome: repository, ...await repository() };
}
const empty = n => ({ ownerId: id(n), dismissedAt: null, calendarViewedAt: null, hasJournalEntry: false });

test('welcome read is private, creates no rows, and migration denies all client access', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.getMemberWelcome(id(1)), empty(1));
  assert.equal((await f.db.query('select count(*) as count from member_welcome_state')).rows[0].count, 0);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await f.db.query("select has_table_privilege($1,'member_welcome_state','SELECT,INSERT,UPDATE,DELETE') as allowed", [role])).rows[0].allowed, false);
  }
  assert.equal((await f.db.query("select relrowsecurity from pg_class where oid='member_welcome_state'::regclass")).rows[0].relrowsecurity, true);
  assert.equal((await f.db.query("select has_table_privilege('service_role','member_welcome_state','SELECT,INSERT,UPDATE,DELETE') as allowed")).rows[0].allowed, true);
  assert.match(await read('scripts/migrate-platform.mjs'), new RegExp(migrationName.replaceAll('.', '\\.')));
});

test('welcome actions persist across devices, are idempotent and isolate each member', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.updateMemberWelcome(id(1), 'resume'), empty(1));
  const first = await f.updateMemberWelcome(id(1), 'dismiss');
  assert.ok(first.dismissedAt);
  assert.deepEqual(await f.updateMemberWelcome(id(1), 'dismiss'), first);
  const otherDevice = await f.loadWelcome();
  assert.deepEqual(await otherDevice.getMemberWelcome(id(1)), first);
  assert.deepEqual(await otherDevice.getMemberWelcome(id(2)), empty(2));
  const viewed = await f.updateMemberWelcome(id(1), 'calendar_viewed');
  assert.ok(viewed.calendarViewedAt); assert.equal(viewed.dismissedAt, first.dismissedAt);
  assert.deepEqual(await f.updateMemberWelcome(id(1), 'calendar_viewed'), viewed);
  const resumed = await otherDevice.updateMemberWelcome(id(1), 'resume');
  assert.deepEqual(resumed, { ...viewed, dismissedAt: null });
  assert.deepEqual(await f.updateMemberWelcome(id(1), 'resume'), resumed);
  assert.deepEqual(await f.getMemberWelcome(id(2)), empty(2));
  assert.equal((await f.db.query('select count(*) as count from member_welcome_state')).rows[0].count, 1);
  await assert.rejects(() => f.updateMemberWelcome(id(1), 'invented'), error => error.status === 400);
  await f.db.query('delete from ruined_members where id=$1', [id(101)]);
  assert.equal((await f.db.query('select count(*) as count from member_welcome_state')).rows[0].count, 0);
});

test('journal progress requires actual current private owner evidence and never returns content', async t => {
  const f = await fixture(t);
  await f.db.exec('alter table member_journal_entries add column body text');
  const entry = async (n, member, visibility, deleted = null, date = '2026-01-01T00:00:00Z', shared = false) => f.db.query(
    'insert into member_journal_entries(id,member_id,visibility,deleted_at,created_at,body,include_on_timeline) values($1,$2,$3,$4,$5,$6,$7)',
    [id(n), id(member + 100), visibility, deleted, date, 'Private contents must never leave this query.', shared],
  );
  await entry(400, 2, 'private');
  await entry(401, 1, 'public', null, '2026-01-01T00:00:00Z', true);
  await entry(402, 1, 'private', '2026-01-02T00:00:00Z');
  await entry(403, 1, 'private', null, '2200-01-01T00:00:00Z');
  assert.deepEqual(await f.getMemberWelcome(id(1)), empty(1));
  await entry(404, 1, 'private');
  assert.deepEqual(await f.getMemberWelcome(id(1)), { ...empty(1), hasJournalEntry: true });
  await f.db.query('update member_journal_entries set deleted_at=now() where id=$1', [id(404)]);
  assert.deepEqual(await f.getMemberWelcome(id(1)), empty(1));
  assert.deepEqual(await f.getMemberWelcome(id(2)), { ...empty(2), hasJournalEntry: true });
  // Historical public visibility without Add to Timeline is still private in
  // the real Journal collection, so it must receive the same welcome credit.
  await entry(405, 1, 'public');
  assert.deepEqual(await f.getMemberWelcome(id(1)), { ...empty(1), hasJournalEntry: true });
  await f.db.query('update member_journal_entries set include_on_timeline=true where id=$1', [id(405)]);
  assert.deepEqual(await f.getMemberWelcome(id(1)), empty(1));
});

test('welcome uses current profile release, identity, active role and lifecycle gates for reads and writes', async t => {
  const f = await fixture(t);
  const deniedStates = [
    ['update ruined_members set released=false where id=$1', [id(101)]],
    ['update ruined_members set deleted_at=now() where id=$1', [id(101)]],
    ["update platform_users set status='suspended' where auth_user_id=$1", [id(1)]],
    ["update people set status='inactive' where id=$1", [id(201)]],
    ["update member_lifecycle set account_state='suspended' where member_id=$1", [id(101)]],
    ["update member_lifecycle set account_state='closed' where member_id=$1", [id(101)]],
    ['update platform_role_grants set revoked_at=now() where auth_user_id=$1', [id(1)]],
    ['update platform_users set member_id=$1 where auth_user_id=$2', [id(102), id(1)]],
    ['update platform_users set person_id=$1 where auth_user_id=$2', [id(202), id(1)]],
  ];
  for (const [sql, values] of deniedStates) {
    await f.db.query(sql, values);
    await assert.rejects(() => f.getMemberWelcome(id(1)), error => error instanceof model.MemberWelcomeError && error.status === 403);
    await assert.rejects(() => f.updateMemberWelcome(id(1), 'dismiss'), error => error.status === 403);
    await f.db.query('update ruined_members set released=true,deleted_at=null where id=$1', [id(101)]);
    await f.db.query("update platform_users set status='active',member_id=$1,person_id=$2 where auth_user_id=$3", [id(101), id(201), id(1)]);
    await f.db.query("update people set status='active' where id=$1", [id(201)]);
    await f.db.query("update member_lifecycle set account_state='active' where member_id=$1", [id(101)]);
    await f.db.query('update platform_role_grants set revoked_at=null where auth_user_id=$1', [id(1)]);
  }
  assert.equal((await f.db.query('select count(*) as count from member_welcome_state')).rows[0].count, 0);
  await f.db.query('update platform_users set member_id=null where auth_user_id=$1', [id(1)]);
  assert.deepEqual(await f.getMemberWelcome(id(1)), empty(1));
  await assert.rejects(() => f.getMemberWelcome(id(99)), error => error.status === 403);
});

test('missing welcome migration fails closed without guessing progress or persisting it', async t => {
  const f = await fixture(t);
  await f.db.exec('drop table member_welcome_state');
  await assert.rejects(() => f.getMemberWelcome(id(1)), error => error.code === '42P01');
  await assert.rejects(() => f.updateMemberWelcome(id(1), 'calendar_viewed'), error => error.code === '42P01');
});
