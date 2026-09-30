import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadPGliteForSchemaChecks } from "../../scripts/check-support-schema.mjs";

export const coupleCircleMigration = "db/migrations/20260930113000_couple_circle_placement.sql";
const source = path => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

// Isolated database schema around the exact shipped placement functions. No
// provider, authentication session, network, or production database is involved.
export async function coupleCircleFixture(t) {
  const DB = await loadPGliteForSchemaChecks(), db = new DB();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table platform_users(auth_user_id uuid primary key, person_id uuid);
    create table ruined_members(id uuid primary key, person_id uuid not null, deleted_at timestamptz);
    create table member_lifecycle(member_id uuid primary key references ruined_members,
      account_state text not null default 'active', cancellation_effective_at timestamptz);
    create table circles(id uuid primary key, capacity int not null default 10, updated_at timestamptz);
    create table circle_member_assignments(id bigint generated always as identity primary key,
      member_id uuid references ruined_members, circle_id uuid references circles,
      assigned_by_auth_user_id uuid references platform_users, assigned_at timestamptz not null default now(), ended_at timestamptz);
    create unique index one_current_circle on circle_member_assignments(member_id) where ended_at is null;
    create table circle_staff_assignments(circle_id uuid,auth_user_id uuid,role_slug text,ended_at timestamptz);
    create function private.ruined_has_leadership_responsibility(uuid,text) returns boolean language sql as $$ select false $$;
    create table membership_couple_authorizations(id uuid primary key,payer_member_id uuid references ruined_members,
      partner_member_id uuid references ruined_members,accepted_at timestamptz,accepted_by_auth_user_id uuid,
      expires_at timestamptz default now()+interval '7 days',revoked_at timestamptz);
    create table membership_commercial_reservations(id uuid primary key,payer_member_id uuid references ruined_members,
      kind text not null, status text not null default 'reserved',couple_authorization_id uuid references membership_couple_authorizations,
      stripe_subscription_id text,created_at timestamptz default now(),expires_at timestamptz default now()+interval '1 hour');
    create table membership_commercial_participants(reservation_id uuid references membership_commercial_reservations,
      member_id uuid references ruined_members,person_id uuid not null,ordinal int not null,
      primary key(reservation_id,member_id),unique(reservation_id,ordinal),unique(reservation_id,person_id));
    create table membership_enrollment_episodes(id uuid primary key default gen_random_uuid(),
      reservation_id uuid references membership_commercial_reservations,member_id uuid references ruined_members,ended_at timestamptz);
    create table stripe_subscriptions(id text primary key,member_id uuid references ruined_members,stripe_status text,cancel_at timestamptz);
  `);
  await db.exec(await source("db/migrations/20260930101000_circle_placement.sql"));
  await db.exec(`create trigger circle_member_assignments_capacity before insert or update of circle_id,ended_at
    on circle_member_assignments for each row execute function public.ruined_enforce_circle_capacity()`);
  await db.exec(await source(coupleCircleMigration));
  const actor = randomUUID(), circleA = randomUUID(), circleB = randomUUID();
  await db.query("insert into platform_users(auth_user_id) values($1)", [actor]);
  await db.query("insert into circles(id) values($1),($2)", [circleA, circleB]);
  async function member() {
    const id = randomUUID();
    await db.query("insert into ruined_members(id,person_id) values($1,$1)", [id]);
    await db.query("insert into member_lifecycle(member_id) values($1)", [id]);
    return id;
  }
  async function pair({ payer, partner, accepted = true, activated = false, afterQuote } = {}) {
    payer ??= await member(); partner ??= await member();
    const approval = randomUUID(), reservation = randomUUID(), subscription = `sub_${randomUUID().replaceAll("-", "")}`;
    await db.transaction(async tx => {
      await tx.query(`insert into membership_couple_authorizations(id,payer_member_id,partner_member_id,accepted_at,accepted_by_auth_user_id)
        values($1,$2,$3,case when $4 then now() end,case when $4 then $5::uuid end)`, [approval,payer,partner,accepted,actor]);
      if (activated) await tx.query("insert into stripe_subscriptions values($1,$2,'active',null)", [subscription,payer]);
      await tx.query(`insert into membership_commercial_reservations(id,payer_member_id,kind,status,couple_authorization_id,stripe_subscription_id)
        values($1,$2,'couple',$3,$4,$5)`, [reservation,payer,activated ? "activated" : "reserved",approval,activated ? subscription : null]);
      await tx.query(`insert into membership_commercial_participants(reservation_id,member_id,person_id,ordinal)
        values($1,$2,$2,1),($1,$3,$3,2)`, [reservation,payer,partner]);
      await afterQuote?.();
      if (activated) await tx.query("insert into membership_enrollment_episodes(reservation_id,member_id) values($1,$2),($1,$3)", [reservation,payer,partner]);
    });
    return { payer, partner, approval, reservation, subscription };
  }
  async function place(memberId, circleId = circleA, engine = db) {
    return (await engine.query(`insert into circle_member_assignments(member_id,circle_id,assigned_by_auth_user_id)
      values($1,$2,$3) returning id::text`, [memberId,circleId,actor])).rows[0].id;
  }
  async function partnerOf(memberId) {
    return (await db.query("select private.ruined_circle_couple_partner($1) as partner", [memberId])).rows[0].partner;
  }
  const placements = async () => (await db.query("select member_id,circle_id from circle_member_assignments where ended_at is null order by member_id")).rows;
  return { db, actor, circleA, circleB, member, pair, place, partnerOf, placements };
}
