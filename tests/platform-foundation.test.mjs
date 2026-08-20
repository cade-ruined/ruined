import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const [
  platformConfig,
  pageData,
  authSession,
  authRequestRoute,
  authVerifyRoute,
  supabaseMiddleware,
  rootMiddleware,
  checkoutRoute,
  billingRepository,
  platformMigration,
  platformModel,
  platformRepository,
  memberFoundationsPage,
  memberCirclePage,
  memberArtifactsPage,
  memberLayout,
  opsLayout,
  signOutRoute,
] = await Promise.all([
  source("src/lib/platform/config.ts"),
  source("src/lib/platform/page-data.ts"),
  source("src/lib/auth/session.ts"),
  source("app/api/auth/otp/request/route.ts"),
  source("app/api/auth/otp/verify/route.ts"),
  source("src/lib/supabase/middleware.ts"),
  source("middleware.ts"),
  source("app/api/stripe/checkout/route.ts"),
  source("src/lib/stripe/billing-repository.ts"),
  source("db/migrations/20260819_platform_foundation.sql"),
  source("src/lib/platform/model.ts"),
  source("src/lib/platform/repository.ts"),
  source("app/my/foundations/page.tsx"),
  source("app/my/circle/page.tsx"),
  source("app/my/artifacts/page.tsx"),
  source("app/my/layout.tsx"),
  source("app/ops/layout.tsx"),
  source("app/api/auth/sign-out/route.ts"),
]);

test("preview is development-only and never fabricates an authenticated viewer", () => {
  assert.match(
    platformConfig,
    /process\.env\.NODE_ENV !== "production" && requestedMode === "preview"/,
  );
  assert.match(
    platformConfig,
    /const mode: PlatformMode = previewAllowed[\s\S]*\? "preview"[\s\S]*supabaseConfigured && databaseConfigured[\s\S]*\? "connected"[\s\S]*: "unavailable"/,
  );
  assert.match(platformConfig, /stripeCheckoutReady:[\s\S]*mode === "connected"/);

  assert.match(pageData, /state: "preview", viewer: null/);
  assert.match(pageData, /dashboard: PREVIEW_OPERATOR_DASHBOARD[\s\S]*state: "preview"[\s\S]*viewer: null/);
  assert.match(pageData, /const viewer = await getCurrentPlatformViewer\(\)/);

  assert.match(authSession, /await supabase\.auth\.getClaims\(\)/);
  assert.match(authSession, /return \{ authUserId, email: email\.trim\(\)\.toLowerCase\(\) \}/);
  assert.doesNotMatch(authSession, /PREVIEW|preview@|request\.cookies\.get/);
  assert.match(
    supabaseMiddleware,
    /getPlatformConfiguration\(\)\.mode !== "connected"[\s\S]*claims: null, configured: false/,
  );
  assert.match(memberLayout, /configuration\.mode === "connected" \? await getCurrentPlatformViewer\(\) : null/);
  assert.match(opsLayout, /configuration\.mode === "connected" \? await getCurrentPlatformViewer\(\) : null/);
  assert.match(signOutRoute, /getPlatformConfiguration\(\)\.mode !== "connected"\) return response/);
});

test("paid active membership is a server-side boundary for private member areas", () => {
  assert.match(
    platformModel,
    /hasActiveMemberAccess[\s\S]*accountState === "active"[\s\S]*billingState === "active"[\s\S]*programState === "onboarding"/,
  );
  assert.match(platformRepository, /existingLifecycle\?\.program_state \?\? "prospect"/);

  for (const route of [memberFoundationsPage, memberCirclePage, memberArtifactsPage]) {
    assert.match(route, /context\.state !== "preview"/);
    assert.match(route, /!hasActiveMemberAccess\(context\.member\)/);
    assert.match(route, /redirect\("\/my\/account"\)/);
  }
});

test("passwordless OTP endpoints enforce origin, audience, and generic delivery boundaries", () => {
  for (const route of [authRequestRoute, authVerifyRoute]) {
    assert.match(route, /isTrustedPlatformOrigin\(request\)/);
    assert.match(route, /status: 403/);
    assert.match(route, /createSupabaseCurrentResponseClient\(\{ request, response \}\)/);
    assert.match(route, /status: 503/);
  }

  assert.match(authRequestRoute, /body\?\.audience === "ops" \? "ops" : "member"/);
  assert.match(authRequestRoute, /signInWithOtp\(\{[\s\S]*options: \{ shouldCreateUser: audience === "member" \}/);
  assert.match(authRequestRoute, /const response = NextResponse\.json\(\{ ok: true \}\)/);
  assert.match(authRequestRoute, /if \(error\) \{[\s\S]*console\.warn[\s\S]*\}[\s\S]*return response/);
  assert.doesNotMatch(authRequestRoute, /console\.(?:warn|error|log)\([^)]*email/);

  assert.match(authVerifyRoute, /const TOKEN_PATTERN = \/\^\\d\{6,10\}\$\//);
  assert.match(authVerifyRoute, /safePlatformNextPath\(body\?\.next, audience\)/);
  assert.match(authVerifyRoute, /verifyOtp\(\{ email, token, type: "email" \}\)/);
  assert.match(authVerifyRoute, /if \(error \|\| !data\.user\)/);
});

test("middleware refreshes verified claims for every protected platform boundary", () => {
  assert.match(supabaseMiddleware, /await supabase\.auth\.getClaims\(\)/);
  assert.match(supabaseMiddleware, /cookiesToSet\.forEach/);
  assert.match(rootMiddleware, /refreshSupabaseMiddlewareSession\(request\)/);

  for (const matcher of [
    "/my/:path*",
    "/ops/:path*",
    "/api/auth/:path*",
    "/api/stripe/checkout/:path*",
    "/api/stripe/portal/:path*",
  ]) {
    assert.ok(rootMiddleware.includes(`"${matcher}"`), `${matcher} is not protected by middleware`);
  }
});

test("Checkout derives identity from verified claims and keeps the offer server-owned", () => {
  const requestType = checkoutRoute.match(/type CheckoutRequest = \{([\s\S]*?)\n\};/)?.[1] ?? "";

  assert.doesNotMatch(requestType, /email|price|amount|quantity/i);
  assert.match(checkoutRoute, /const viewer = await getCurrentPlatformViewer\(\)/);
  assert.match(checkoutRoute, /if \(!viewer\)[\s\S]*status: 401/);
  assert.match(checkoutRoute, /ensurePlatformMemberForViewer\(viewer\)/);
  assert.match(checkoutRoute, /normalizeEmail\(viewer\.email\)/);
  assert.match(checkoutRoute, /customer_email: email/);
  assert.doesNotMatch(checkoutRoute, /body\.(?:email|price|priceId|amount|quantity)/);
  assert.match(checkoutRoute, /const priceId = getStripeMembershipPriceId\(\)/);
  assert.match(checkoutRoute, /line_items: \[\{ price: priceId, quantity: 1 \}\]/);
  assert.match(checkoutRoute, /integration_identifier: "ruined_my_[a-z]{8}"/);
});

test("platform migration creates durable, independent, versioned state", () => {
  const requiredTables = [
    "platform_users",
    "platform_role_grants",
    "member_lifecycle",
    "member_state_history",
    "member_consents",
    "circles",
    "circle_member_assignments",
    "circle_staff_assignments",
    "foundation_programs",
    "foundation_versions",
    "foundation_enrollments",
    "membership_offers",
    "membership_prices",
    "artifact_templates",
    "artifact_template_versions",
    "artifact_jobs",
    "artifact_assets",
    "artifact_job_events",
    "integration_entity_links",
    "integration_outbox",
  ];

  for (const table of requiredTables) {
    assert.match(
      platformMigration,
      new RegExp(`create table if not exists ${table} \\(`),
      `${table} is missing from the platform migration`,
    );
  }

  const lifecycleDefinition = platformMigration.match(
    /create table if not exists member_lifecycle \(([\s\S]*?)\n\);/,
  )?.[1] ?? "";
  for (const dimension of [
    "account_state",
    "billing_state",
    "program_state",
    "foundations_state",
    "artifact_state",
  ]) {
    assert.match(lifecycleDefinition, new RegExp(`\\b${dimension}\\b`));
  }

  assert.match(platformMigration, /capacity integer not null default 10 check \(capacity > 0\)/);
  assert.match(platformMigration, /function ruined_enforce_circle_capacity\(\)/);
  assert.match(platformMigration, /if active_count >= allowed_capacity then/);
  assert.match(platformMigration, /circle_member_assignments_capacity/);

  assert.match(platformMigration, /unique \(foundation_program_id, version\)/);
  assert.match(platformMigration, /unique \(artifact_template_id, version\)/);
  assert.match(platformMigration, /artifact_template_version_id uuid not null/);
  assert.match(platformMigration, /membership_prices_immutable/);
  assert.match(platformMigration, /artifact_template_versions_immutable/);
  assert.match(platformMigration, /artifact_jobs_identity_immutable/);
  for (const functionName of [
    "ruined_reject_append_only_mutation",
    "ruined_protect_foundation_version",
    "ruined_protect_membership_price",
    "ruined_protect_artifact_template_version",
  ]) {
    assert.match(
      platformMigration,
      new RegExp(`function ${functionName}\\(\\)[\\s\\S]{0,100}set search_path = ''`),
    );
  }

  assert.match(platformMigration, /dedupe_key text not null unique/);
  assert.match(platformMigration, /integration_outbox_delivery_idx/);
  assert.match(platformMigration, /where status in \('pending', 'failed'\)/);
});

test("platform RLS defaults to self-read surfaces without client write policies", () => {
  for (const table of [
    "platform_users",
    "member_private_profiles",
    "member_lifecycle",
    "member_state_history",
    "member_consents",
    "circles",
    "foundation_versions",
    "foundation_units",
    "artifact_templates",
    "artifact_template_versions",
    "artifact_jobs",
    "integration_outbox",
  ]) {
    assert.match(
      platformMigration,
      new RegExp(`alter table ${table} enable row level security;`),
    );
  }

  assert.match(platformMigration, /create schema if not exists private;/);
  assert.match(
    platformMigration,
    /create or replace function private\.ruined_current_member_id\(\)[\s\S]*security definer[\s\S]*set search_path = ''/,
  );
  assert.match(
    platformMigration,
    /revoke all on function private\.ruined_current_member_id\(\) from public, anon, authenticated;/,
  );
  assert.match(platformMigration, /grant select on table[\s\S]*platform_users[\s\S]*to authenticated;/);
  assert.match(platformMigration, /on platform_users for select\s+to authenticated/);
  assert.match(
    platformMigration,
    /using \(auth_user_id = private\.ruined_current_auth_user_id\(\)\)/,
  );
  assert.match(
    platformMigration,
    /using \(member_id = private\.ruined_current_member_id\(\)\)/,
  );
  assert.doesNotMatch(
    platformMigration,
    /create or replace function ruined_current_member_id\(\)/,
  );
  assert.match(platformMigration, /foundation_submissions_enrollment_version_idx/);
  assert.match(platformMigration, /foundation_submission_reviews_submission_idx/);
  assert.match(platformMigration, /artifact_jobs_template_version_idx/);
  assert.doesNotMatch(platformMigration, /create policy[\s\S]{0,120}\bfor (?:insert|update|delete|all)\b/i);
  assert.doesNotMatch(platformMigration, /\b(?:otp|magic_link|password)_token\b/i);
});

test("Stripe billing changes update only the canonical billing and paid-program lifecycle", () => {
  const stateWriter = billingRepository.slice(
    billingRepository.indexOf("export async function updateMemberBillingState"),
  );

  assert.match(stateWriter, /insert into member_lifecycle \(member_id, billing_state\)/);
  assert.match(stateWriter, /update member_lifecycle[\s\S]*set[\s\S]*billing_state =/);
  assert.doesNotMatch(stateWriter, /(?:account|program|foundations|artifact)_state\s*=/);
  assert.match(stateWriter, /insert into member_state_history/);
  assert.match(stateWriter, /'billing'[\s\S]*'stripe_webhook'[\s\S]*'stripe'/);
  assert.match(stateWriter, /source_event_id[\s\S]*input\.sourceEventId/);
  assert.doesNotMatch(stateWriter, /hubspot|member\.summary\.refresh/i);
});
