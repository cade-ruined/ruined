import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = (relativePath) => readFile(path.join(root, relativePath), "utf8");

const paths = {
  env: ".env.example",
  form: "src/components/events/BYOBRegistrationForm.tsx",
  model: "src/lib/events/registration-sheet-model.ts",
  publicApi: "app/api/events/byob-02/register/route.ts",
  route: "app/api/internal/integrations/google-sheets/process/route.ts",
  sheets: "src/lib/google/sheets.ts",
  sync: "src/lib/events/registration-sheet-sync.ts",
  vercel: "vercel.json",
};

async function migrationCorpus() {
  const directory = path.join(root, "db/migrations");
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  return (await Promise.all(names.map((name) => readFile(path.join(directory, name), "utf8"))))
    .join("\n");
}

function quotedStrings(value) {
  return [...value.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

test("Google Sheet credentials and configuration stay server-only", async () => {
  const [environment, sheets, sync, form, publicApi] = await Promise.all([
    source(paths.env),
    source(paths.sheets),
    source(paths.sync),
    source(paths.form),
    source(paths.publicApi),
  ]);
  const publicSurface = `${form}\n${publicApi}`;

  assert.match(sheets, /^import "server-only";/);
  assert.match(sync, /^import "server-only";/);
  for (const name of [
    "GOOGLE_REGISTRATION_SHEET_ENABLED",
    "GOOGLE_REGISTRATION_SPREADSHEET_ID",
    "GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64",
  ]) {
    const defaultValue = name === "GOOGLE_REGISTRATION_SHEET_ENABLED" ? "false" : "";
    assert.match(environment, new RegExp(`(?:^|\\n)${name}=${defaultValue}(?:\\n|$)`));
    assert.match(sheets, new RegExp(`process\\.env\\.${name}`));
  }
  assert.doesNotMatch(environment, /NEXT_PUBLIC_GOOGLE_/);
  assert.doesNotMatch(publicSurface, /GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64/);
  assert.doesNotMatch(form, /GOOGLE_REGISTRATION_|googleapis|google-auth-library/);
  assert.match(sheets, /Buffer\.from\([^)]*,\s*"base64"\)/);
  assert.match(sheets, /GoogleAuth/);
  assert.match(sheets, /https:\/\/www\.googleapis\.com\/auth\/spreadsheets/);
  assert.match(sheets, /GOOGLE_REGISTRATION_SHEET_ENABLED[\s\S]*?=== "true"/);
});

test("the Registrants tab has one exact minimal A:I projection", async () => {
  const [model, sheets, sync] = await Promise.all([
    source(paths.model),
    source(paths.sheets),
    source(paths.sync),
  ]);
  const combined = `${model}\n${sheets}\n${sync}`;
  const headersLiteral = combined.match(
    /REGISTRATION_SHEET_HEADERS\s*=\s*\[([\s\S]*?)\]\s*as const/,
  )?.[1];

  assert.ok(headersLiteral, "the Sheet headers must remain a literal, reviewable contract");
  assert.deepEqual(quotedStrings(headersLiteral), [
    "Registered at",
    "First name",
    "Last name",
    "Email",
    "Instagram",
    "Status",
    "Waiver accepted",
    "Waiver version",
    "Registration ID",
  ]);
  assert.match(combined, /REGISTRATION_SHEET_TAB\s*=\s*"Registrants"/);
  assert.match(sync, /from community_event_registrations/);
  assert.match(
    sync,
    /import \{ BYOB_02_EVENT_KEY \} from "@\/lib\/events\/byob-registration-model"/,
  );
  for (const column of [
    "id",
    "created_at",
    "registrant_first_name",
    "registrant_last_name",
    "email_normalized",
    "instagram_handle",
    "status",
    "waiver_accepted_at",
    "waiver_version",
  ]) {
    assert.match(sync, new RegExp(`\\b${column}\\b`));
  }
  assert.doesNotMatch(
    sync,
    /waiver_acceptance_evidence|waiver_sha256|fingerprint_hash|community_event_registration_guests/,
    "the operations mirror must not copy legal evidence or abuse-prevention data",
  );
  assert.doesNotMatch(sync, /event\.payload(?:\.|\[)/);

  const singleRegistrationQuery = sync.slice(
    sync.indexOf("async function getCanonicalRegistration"),
    sync.indexOf("async function listCanonicalRegistrations"),
  );
  const registrationListQuery = sync.slice(
    sync.indexOf("async function listCanonicalRegistrations"),
    sync.indexOf("async function ensureRegistrationSheetStructure"),
  );
  assert.match(
    singleRegistrationQuery,
    /where id = \$\{registrationId\}::uuid[\s\S]*?and event_key = \$\{BYOB_02_EVENT_KEY\}/,
    "an outbox aggregate ID must not pull a registration from another event",
  );
  assert.match(
    registrationListQuery,
    /where event_key = \$\{BYOB_02_EVENT_KEY\}/,
    "authoritative reconciliation must remain scoped to BYOB Nº 02",
  );

  const rowBuilderStart = model.search(/(?:function|const)\s+(?:build|to)[A-Za-z]*Registration[A-Za-z]*Row/i);
  const rowBuilderEnd = model.indexOf("\n}", rowBuilderStart);
  const rowBuilder = model.slice(rowBuilderStart, rowBuilderEnd);
  assert.ok(rowBuilderStart >= 0 && rowBuilderEnd > rowBuilderStart, "a named row projection must be inspectable");
  const expectedOrder = [
    /(?:createdAt|registeredAt)/,
    /(?:registrantFirstName|firstName)/,
    /(?:registrantLastName|lastName)/,
    /email(?:Normalized)?/,
    /instagram(?:Handle)?/,
    /status/,
    /waiverAcceptedAt/,
    /waiverVersion/,
    /(?:registrationId|\.id\b)/,
  ];
  let cursor = -1;
  for (const field of expectedOrder) {
    const match = rowBuilder.slice(cursor + 1).search(field);
    assert.ok(match >= 0, `row projection is missing ${field}`);
    cursor += match + 1;
  }
});

test("Google writes use RAW values and hidden UUID column I for retry-safe upserts", async () => {
  const [model, sheets, sync] = await Promise.all([
    source(paths.model),
    source(paths.sheets),
    source(paths.sync),
  ]);

  assert.doesNotMatch(sheets, /USER_ENTERED/);
  assert.ok(
    (sheets.match(/valueInputOption:\s*"RAW"/g) ?? []).length >= 2,
    "both appends and updates must disable formula interpretation",
  );
  assert.match(sync, /\$\{REGISTRATION_SHEET_TAB\}!I2:I/);
  assert.match(sync, /\$\{REGISTRATION_SHEET_TAB\}!A\$\{[^}]+\}:I\$\{[^}]+\}/);
  assert.match(sync, /\$\{REGISTRATION_SHEET_TAB\}!A:I/);
  assert.match(sheets, /insertDataOption:\s*"INSERT_ROWS"/);
  assert.match(sheets, /values\/[\s\S]*?:append|:append["'`]/);
  assert.match(sheets, /method:\s*"PUT"/);
  assert.match(sheets, /method:\s*"POST"/);

  assert.match(sheets, /:batchUpdate/);
  assert.match(sheets, /updateDimensionProperties/);
  assert.match(sheets, /dimension:\s*"COLUMNS"/);
  assert.match(sheets, /startIndex:\s*zeroBasedColumnIndex/);
  assert.match(sheets, /endIndex:\s*zeroBasedColumnIndex \+ 1/);
  assert.match(sheets, /hiddenByUser:\s*true/);
  assert.match(sheets, /fields:\s*"hiddenByUser"/);
  assert.match(model, /REGISTRATION_ID_COLUMN_INDEX\s*=\s*8/);
  assert.match(sync, /configureGoogleRegistrationSheet\([\s\S]*?REGISTRATION_SHEET_TAB/);
  assert.match(sheets, /properties:\s*\{ timeZone:\s*"America\/Denver" \}/);
  assert.ok(
    (sheets.match(/type:\s*"DATE_TIME"/g) ?? []).length >= 2,
    "registered and waiver timestamps need visible date-time formatting",
  );

  const lookupStart = sync.indexOf("async function upsertRegistrationSheetRow");
  const lookupEnd = sync.indexOf("\n}", lookupStart);
  const lookup = sync.slice(lookupStart, lookupEnd);
  assert.ok(lookupStart >= 0 && lookupEnd > lookupStart, "UUID upsert logic must be inspectable");
  assert.match(lookup, /findRegistrationSheetRowNumber/);
  assert.match(lookup, /I2:I/);
  assert.doesNotMatch(lookup, /email(?:Normalized)?\s*===|find\([^\n]*email/i);
});

test("Google outbox work is leased, retried, dead-lettered, and marked after the remote write", async () => {
  const sync = await source(paths.sync);

  assert.match(sync, /destination = 'google'/);
  assert.match(
    sync,
    /REGISTRATION_SHEET_EVENT_TYPE\s*=\s*\n?\s*"community_event_registration\.sheet_sync_requested"/,
  );
  assert.match(
    sync,
    /event_type = (?:\$\{REGISTRATION_SHEET_EVENT_TYPE\}|'community_event_registration\.sheet_sync_requested')/,
  );
  assert.match(sync, /for update skip locked/);
  assert.match(sync, /attempts < \$\{MAX_ATTEMPTS\}/);
  assert.match(sync, /const STALE_LOCK_MINUTES\s*=\s*\d+/);
  assert.match(sync, /status = 'processing'[\s\S]*?locked_at < now\(\) -/);
  assert.match(sync, /const terminal = event\.attempts >= MAX_ATTEMPTS/);
  assert.match(sync, /status = \$\{terminal \? "dead_letter" : "failed"\}/);
  assert.match(sync, /now\(\) \+ \(\$\{backoffSeconds\} \* interval '1 second'\)/);
  assert.match(sync, /where id = \$\{[^}]+\}::bigint[\s\S]*?locked_by = \$\{workerId\}/);
  assert.match(sync, /const errorName = error instanceof Error && error\.name \? error\.name : "Error"/);
  assert.doesNotMatch(sync, /error\.message/);

  const processStart = sync.indexOf("export async function processRegistrationSheetOutboxBatch");
  const processWorker = sync.slice(processStart);
  const remoteWrite = processWorker.indexOf("await upsertRegistrationSheetRow(");
  const succeeded = processWorker.indexOf(
    "await markRegistrationSheetEventSucceeded(",
    remoteWrite,
  );
  assert.ok(processStart >= 0, "the bounded Sheet worker must be exported");
  assert.ok(remoteWrite >= 0, "the worker must perform an idempotent remote upsert");
  assert.ok(succeeded > remoteWrite, "an event may succeed only after the Sheet write completes");
});

test("reconciliation restores the exact canonical mirror and removes stale trailing rows", async () => {
  const sync = await source(paths.sync);
  const start = sync.indexOf("export async function reconcileRegistrationSheet");
  const reconcile = sync.slice(start);

  assert.ok(start >= 0, "the reconciliation entry point must be exported");
  assert.match(reconcile, /listCanonicalRegistrations\(\)/);
  assert.match(reconcile, /getGoogleSheetValues\([^)]*A2:I/);
  assert.match(reconcile, /registrations\.map\(buildRegistrationSheetRow\)/);
  assert.match(reconcile, /ensureRegistrationSheetStructure\(spreadsheetId\)/);
  assert.match(reconcile, /updateGoogleSheetValues\([\s\S]*?A2:I\$\{rows\.length \+ 1\}/);
  assert.match(reconcile, /existingRows\.length > rows\.length/);
  assert.match(reconcile, /clearGoogleSheetValues\([\s\S]*?rows\.length \+ 2[\s\S]*?existingRows\.length \+ 1/);
});

test("the Sheet worker route is private and participates in durable cron recovery", async () => {
  const [route, vercel] = await Promise.all([
    source(paths.route),
    source(paths.vercel),
  ]);

  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /authorization/);
  assert.match(route, /authorization\.startsWith\("Bearer "\)/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /status:\s*401/);
  assert.match(route, /await reconcileRegistrationSheet\(\)/);
  assert.match(route, /export const maxDuration\s*=\s*60/);
  assert.match(route, /await processRegistrationSheetOutboxBatch\(8\)/);
  assert.match(route, /"Cache-Control":\s*"private, no-store"/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(
    vercel,
    /"path":\s*"\/api\/internal\/integrations\/google-sheets\/process"/,
  );
});

test("registrants and integration state have no browser or Supabase Data API read path", async () => {
  const [migrations, publicApi, form, sheets, sync] = await Promise.all([
    migrationCorpus(),
    source(paths.publicApi),
    source(paths.form),
    source(paths.sheets),
    source(paths.sync),
  ]);
  const publicSurface = `${publicApi}\n${form}`;

  assert.match(migrations, /alter table\s+(?:public\.)?community_event_registrations enable row level security/i);
  assert.match(
    migrations,
    /revoke all on table[\s\S]*?community_event_registrations[\s\S]*?from public, anon, authenticated(?:, service_role)?/i,
  );
  assert.match(migrations, /alter table\s+(?:public\.)?integration_outbox enable row level security/i);
  assert.match(
    migrations,
    /revoke all on table[\s\S]*?integration_outbox[\s\S]*?from anon, authenticated/i,
  );
  assert.doesNotMatch(publicApi, /export async function GET/);
  assert.doesNotMatch(publicSurface, /registrationId|spreadsheetId|sheetUrl|syncStatus/);
  assert.doesNotMatch(publicSurface, /GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64/);
  assert.doesNotMatch(`${sheets}\n${sync}`, /SUPABASE_SECRET_KEY|NEXT_PUBLIC_SUPABASE/);
  assert.match(publicApi, /const SUCCESS_RESPONSE = \{[\s\S]*?ok:\s*true,[\s\S]*?tankHref:\s*BYOB_02_TANK_HREF,[\s\S]*?\}/);
});
