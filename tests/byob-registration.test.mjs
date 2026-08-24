import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");
const migrationDirectory = path.join(root, "db/migrations");

const LEGACY_WAIVER_V1_VERSION = "byob-02-risk-acknowledgment-v1";
const LEGACY_WAIVER_V1_BODY =
  "BYOB Nº 02 is a voluntary physical gathering. I understand that participation may involve strenuous movement, uneven terrain, changing weather, equipment, and other risks of injury or property damage. I am responsible for deciding whether I can participate safely, using equipment responsibly, and stopping when needed. I knowingly accept these risks for my own participation. This acknowledgment applies only to me; every guest must complete their own acknowledgment before participating.";
const LEGACY_WAIVER_V1_SHA256 =
  "856b80c11f6a063267063e8d4d2644882b6da9edfdebe733881e09e9f8102952";
const LEGACY_WAIVER_V2_VERSION = "byob-02-risk-acknowledgment-v2";
const LEGACY_WAIVER_V2_BODY =
  "BYOB Nº 02 is a voluntary outdoor gathering involving strenuous movement, cold or open water, steep or uneven terrain, changing weather, equipment, transportation or carpooling, other participants, and risks of injury, illness, death, or property loss. I confirm that I am able to participate safely, will use equipment responsibly, and will stop when needed. I knowingly and voluntarily assume the inherent and other risks of my participation. To the fullest extent permitted by Utah law, I release and covenant not to sue The Ruined Project LLC; the United States of America, acting through the U.S. Department of Agriculture, Forest Service, including the Uinta-Wasatch-Cache National Forest and Pleasant Grove Ranger District; and North Utah County Water Conservancy District, together with their respective officials, members, managers, officers, directors, employees, agents, volunteers, contractors, successors, and assigns, for claims arising from my participation, including claims based on ordinary negligence. This release does not apply to gross negligence or reckless, willful, or wanton misconduct. Carpooling is voluntary and privately arranged; drivers and passengers are responsible for lawful operation, insurance, seat belts, and vehicle safety, and the released parties do not select or control drivers or vehicles. I will share this acknowledgment with every guest. Each adult guest must accept it for themselves before participating. A parent or legal guardian must provide consent and acknowledge the risks for any guest under 18. Listing a guest does not sign for them.";
const LEGACY_WAIVER_V2_SHA256 =
  "2ebe0e0eeaf274e48956111c0757a50362ec6c186d7a72ab4d322d6387181c9e";

const paths = {
  api: "app/api/events/byob-02/register/route.ts",
  eventData: "src/data/events.ts",
  eventsIndex: "src/components/events/EventsIndex.tsx",
  footer: "src/components/SiteFooter.tsx",
  form: "src/components/events/BYOBRegistrationForm.tsx",
  migration: "db/migrations/20260821_byob_registration.sql",
  model: "src/lib/events/byob-registration-model.ts",
  page: "app/community/byob-02/register/page.tsx",
  repository: "src/lib/events/byob-registration-repository.ts",
  migrationV3: "db/migrations/20260821_byob_registration_v3.sql",
};

function occurrences(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

async function readMigrationCorpus() {
  const migrationNames = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrations = await Promise.all(
    migrationNames.map((name) => readFile(path.join(migrationDirectory, name), "utf8")),
  );
  return migrations.join("\n");
}

test("only BYOB Nº 02 exposes the dedicated registration path", async () => {
  const [events, index] = await Promise.all([
    read(paths.eventData),
    read(paths.eventsIndex),
  ]);

  assert.equal(
    occurrences(events, /\/community\/byob-02\/register/g),
    1,
    "the registration route should have one canonical event-data owner",
  );
  assert.doesNotMatch(events, /\/community\/byob-01\/register/);
  assert.match(events, /registration\??:\s*EventRegistration/);
  assert.match(events, /label:\s*"Register"/);
  assert.doesNotMatch(events, /Register your group/i);
  assert.match(index, /selected\.registration\?\.status\s*===\s*"Open"/);
  assert.match(index, /href=\{selected\.registration\.href\}/);
});

test("BYOB Nº 02 has a dedicated page and accessible registration form", async () => {
  const [page, form] = await Promise.all([read(paths.page), read(paths.form)]);

  assert.match(page, /BYOBRegistrationForm/);
  assert.match(page, /<BYOBRegistrationForm\b/);
  assert.match(page, /BYOB Nº 02/);
  assert.match(form, /<form\b/);
  assert.match(form, /autoComplete="given-name"/);
  assert.match(form, /autoComplete="family-name"/);
  assert.match(form, /autoComplete="email"/);
  assert.match(form, /instagram/i);
  assert.match(form, /type="checkbox"[\s\S]*required|required[\s\S]*type="checkbox"/);
});

test("registration keeps the recap on Community and presents compact final details", async () => {
  const [page, events, eventsIndex] = await Promise.all([
    read(paths.page),
    read(paths.eventData),
    read(paths.eventsIndex),
  ]);

  assert.match(events, /\/events\/byob-01-recap\.mp4\?v=2/);
  assert.match(events, /\/events\/byob-01-recap-poster\.webp\?v=2/);
  assert.match(eventsIndex, /selected\.video[\s\S]*?<video/);
  assert.doesNotMatch(page, /<video\b|candidate\.video|recap/);
  assert.match(page, /<time dateTime=\{event\.dateTime\}>\{event\.date\}<\/time>/);
  assert.match(page, /\{event\.time\}/);
  assert.match(page, /\{event\.location\}/);
  assert.match(events, /isFirstEvent \|\| isRegistrationEvent[\s\S]*?`\$\{isoDate\}T08:00:00`/);
  assert.match(events, /isRegistrationEvent[\s\S]*?"8:00 AM MST"[\s\S]*?"Details to come"/);
  assert.match(events, /Tibble Fork Reservoir · Hill south of the parking lot/);
});

test("registration removes the legacy spacer and redundant introduction", async () => {
  const [page, form] = await Promise.all([read(paths.page), read(paths.form)]);

  assert.doesNotMatch(page, /\bpt-28\b|\bsm:pt-32\b/);
  assert.doesNotMatch(page, /Community · Registration open/);
  assert.doesNotMatch(
    form,
    /Add everyone coming with you here\. Your registration is complete whether or not you choose to view the tank afterward\./,
  );
});

test("field labels use the red CadeHandy2 signature while fillable controls use workwear blue", async () => {
  const [form, footer] = await Promise.all([read(paths.form), read(paths.footer)]);
  const labelClass = form.match(
    /const FIELD_LABEL_CLASS\s*=\s*\n?\s*"([^"]+)"/,
  )?.[1];
  const inputClass = form.match(
    /const INPUT_CLASS\s*=\s*\n?\s*"([^"]+)"/,
  )?.[1];
  const waiverAcknowledgmentClass = form.match(
    /const WAIVER_ACKNOWLEDGMENT_CLASS\s*=\s*\n?\s*"([^"]+)"/,
  )?.[1];
  const waiverDisclosureClass = form.match(
    /<details className="([^"]+)"/,
  )?.[1];

  assert.ok(labelClass, "the shared field-label class must remain a literal contract");
  assert.match(labelClass, /--color-poster/);
  assert.match(labelClass, /--font-cadehandy2/);
  assert.match(labelClass, /(?:^|\s)\[transform:rotate\(-3deg\)\](?:\s|$)/);
  assert.match(
    labelClass,
    /text-(?:2xl|3xl|4xl)|text-\[(?:1\.[5-9][0-9]*|[2-9](?:\.[0-9]+)?)rem\]/,
    "labels should retain the 1.5rem-or-larger Community signature scale",
  );
  assert.doesNotMatch(labelClass, /(?:^|\s)bg-/);
  assert.doesNotMatch(labelClass, /(?:^|\s)p(?:[trblxy])?-/);

  assert.ok(inputClass, "the shared fillable-control class must remain a literal contract");
  assert.match(inputClass, /bg-\[var\(--color-shop\)\]/);
  assert.ok(
    occurrences(form, /className=\{INPUT_CLASS\}/g) >= 4,
    "every fillable registration control should inherit the workwear-blue field treatment",
  );

  assert.ok(
    waiverAcknowledgmentClass,
    "the required waiver-acknowledgment class must remain literal",
  );
  assert.match(waiverAcknowledgmentClass, /bg-\[var\(--color-shop\)\]/);
  assert.match(
    form,
    /<label htmlFor=\{`\$\{fieldPrefix\}-waiver`\} className=\{WAIVER_ACKNOWLEDGMENT_CLASS\}>/,
  );

  assert.ok(waiverDisclosureClass, "the waiver disclosure must remain present");
  assert.doesNotMatch(
    waiverDisclosureClass,
    /(?:^|\s)bg-/,
    "the waiver reading surface should remain unfilled",
  );
  assert.match(form, /<span className=\{FIELD_LABEL_CLASS\}>First(?: name)?<\/span>/);
  assert.match(form, /<span className=\{FIELD_LABEL_CLASS\}>Last(?: name)?<\/span>/);
  assert.match(form, /<span className=\{FIELD_LABEL_CLASS\}>Email<\/span>/);
  assert.match(form, /<span className=\{FIELD_LABEL_CLASS\}>Instagram · optional<\/span>/);
  assert.doesNotMatch(form, /font-mono|ui-monospace|Menlo|Courier/);
  assert.doesNotMatch(footer, /font-mono/);
});

test("registration removes decorative rules while retaining functional control borders", async () => {
  const [page, form] = await Promise.all([read(paths.page), read(paths.form)]);
  const actionableClasses = [
    [
      "fillable control",
      form.match(/const INPUT_CLASS\s*=\s*\n?\s*"([^"]+)"/)?.[1],
    ],
    [
      "waiver acknowledgment",
      form.match(/const WAIVER_ACKNOWLEDGMENT_CLASS\s*=\s*\n?\s*"([^"]+)"/)?.[1],
    ],
  ];

  const pageHeaderClass = page.match(/<header className="([^"]+)"/)?.[1];
  const eventDetailsClass = page.match(/<dl className="([^"]+)"/)?.[1];
  const formHeadingClass = form.match(
    /<div className="([^"]+)">\s*<h2[^>]*>\s*Registration/,
  )?.[1];
  const waiverDisclosureClass = form.match(/<details className="([^"]+)"/)?.[1];
  const tankOfferClass = form.match(
    /<div className="([^"]+)">(?=[\s\S]{0,1600}?TANK_FLAT_LAY_IMAGE[\s\S]{0,1200}?Optional)/,
  )?.[1];

  for (const [label, className, separator] of [
    ["page heading", pageHeaderClass, /(?:^|\s)border-b(?:\s|$|-)/],
    ["event details", eventDetailsClass, /(?:^|\s)border-y(?:\s|$|-)/],
    ["form heading", formHeadingClass, /(?:^|\s)border-b(?:\s|$|-)/],
    ["waiver disclosure", waiverDisclosureClass, /(?:^|\s)border-y(?:\s|$|-)/],
    ["success tank offer", tankOfferClass, /(?:^|\s)border-y(?:\s|$|-)/],
  ]) {
    assert.ok(className, `${label} class must remain inspectable`);
    assert.doesNotMatch(
      className,
      separator,
      `${label} should use spacing rather than a decorative separator`,
    );
  }
  for (const [label, className] of actionableClasses) {
    assert.ok(className, `${label} class must remain a literal contract`);
    assert.match(className, /bg-\[var\(--color-shop\)\]/, `${label} should remain blue`);
    assert.match(
      className,
      /(?:^|\s)border(?:\s|$)/,
      `${label} should retain a functional boundary`,
    );
  }

  const disclosure = form.match(/<details\b[\s\S]*?<\/details>/)?.[0];
  assert.ok(disclosure, "the native waiver disclosure must remain present");
  assert.doesNotMatch(disclosure.match(/^<details\b[^>]*>/)?.[0] ?? "", /\sopen(?:\s|=|>)/);
  assert.match(disclosure, /<summary\b[\s\S]*?<\/summary>/);
  assert.match(disclosure, /id=\{`\$\{fieldPrefix\}-waiver-copy`\}/);
  assert.match(form, /aria-describedby=\{`\$\{fieldPrefix\}-waiver-copy`\}/);
});

test("the browser posts to the fixed BYOB Nº 02 API without choosing a trusted event ID", async () => {
  const [api, form, model] = await Promise.all([
    read(paths.api),
    read(paths.form),
    read(paths.model),
  ]);

  assert.match(form, /fetch\("\/api\/events\/byob-02\/register"/);
  assert.doesNotMatch(form, /\b(?:eventId|eventKey)\s*:/);
  assert.doesNotMatch(api, /\bbody\.(?:eventId|eventKey)\b/);
  assert.match(api, /BYOB_02_EVENT_KEY/);
  assert.match(model, /BYOB_02_EVENT_KEY\s*=\s*"byob-02"/);
  assert.doesNotMatch(
    model.slice(
      model.indexOf("export type Byob02RegistrationRequest"),
      model.indexOf("export type Byob02RegistrationSubmission"),
    ),
    /event(?:Id|Key)/i,
  );
});

test("the registration endpoint rejects untrusted or abusive submissions before persistence", async () => {
  const api = await read(paths.api);

  assert.match(api, /MAX_BODY_LENGTH\s*=\s*16_384/);
  assert.match(api, /application\/json/i);
  assert.match(api, /isTrustedPlatformOrigin/);
  assert.match(api, /body\.company/);
  assert.match(api, /parseByob02RegistrationInput/);
  assert.match(api, /COMMUNICATION_RATE_LIMIT_SECRET/);
  assert.match(api, /byob-registration:v1/);
  assert.match(api, /consumeByobRegistrationRateLimit/);
  assert.match(api, /json\([\s\S]{0,160}?429[\s\S]{0,100}?Retry-After/);
  assert.match(api, /Retry-After["']?\s*[:,]\s*["']3600["']/);
});

test("the waiver is versioned, immutable, private, and indexed", async () => {
  const [migration, model] = await Promise.all([
    read(paths.migration),
    read(paths.model),
  ]);
  const tables = [
    "community_event_waiver_versions",
    "community_event_registrations",
    "community_event_registration_guests",
    "community_event_registration_rate_limits",
  ];

  assert.match(
    model,
    /BYOB_02_WAIVER_VERSION\s*=\s*\n?\s*"byob-02-risk-acknowledgment-v3"/,
  );
  assert.match(model, /BYOB_02_WAIVER_SHA256/);
  for (const table of tables) {
    assert.match(migration, new RegExp(`create table(?: if not exists)?\\s+(?:public\\.)?${table}`));
    assert.match(migration, new RegExp(`alter table\\s+(?:public\\.)?${table} enable row level security`));
    assert.match(
      migration,
      new RegExp(`revoke all on table[\\s\\S]*?${table}[\\s\\S]*?from public, anon, authenticated, service_role`),
    );
  }
  assert.match(migration, /community_event_registrations[\s\S]*?waiver_version/);
  assert.match(
    migration,
    /foreign key\s*\(\s*event_key\s*,\s*waiver_version\s*\)[\s\S]*?references community_event_waiver_versions\s*\(\s*event_key\s*,\s*version\s*\)[\s\S]*?on update restrict[\s\S]*?on delete restrict/i,
  );
  assert.match(
    migration,
    /create trigger[\s\S]*?before update or delete on community_event_waiver_versions[\s\S]*?ruined_reject_append_only_mutation/i,
  );
  assert.match(migration, /create (?:unique )?index[\s\S]*?community_event_registrations/i);
  assert.match(
    migration,
    /community_event_registration_guests[\s\S]*?primary key\s*\(\s*registration_id\s*,\s*position\s*\)/i,
  );
  assert.match(migration, /create (?:unique )?index[\s\S]*?community_event_registration_rate_limits/i);
});

test("the active v3 waiver matches its immutable seed while preserving v1 and v2", async () => {
  const [migrationCorpus, model] = await Promise.all([
    readMigrationCorpus(),
    read(paths.model),
  ]);
  const modelVersion = model.match(/BYOB_02_WAIVER_VERSION\s*=\s*\n?\s*"([^"]+)"/)?.[1];
  const modelBody = model.match(/BYOB_02_WAIVER_BODY\s*=\s*\n?\s*"([^"]+)"/)?.[1];
  const modelHash = model.match(/BYOB_02_WAIVER_SHA256\s*=\s*\n?\s*"([0-9a-f]{64})"/)?.[1];

  assert.ok(modelVersion, "waiver version constant must be a literal");
  assert.ok(modelBody, "waiver body constant must be a literal");
  assert.ok(modelHash, "waiver hash constant must be a literal");
  assert.equal(
    createHash("sha256").update(modelBody, "utf8").digest("hex"),
    modelHash,
    "the application waiver hash must match the exact displayed text",
  );
  assert.equal(modelVersion, "byob-02-risk-acknowledgment-v3");
  assert.match(migrationCorpus, new RegExp(`'${modelVersion}'`));
  assert.ok(
    migrationCorpus.includes(`'${modelBody.replaceAll("'", "''")}'`),
    "the migration corpus must seed the exact v3 waiver text displayed by the form",
  );
  assert.match(migrationCorpus, new RegExp(`'${modelHash}'`));

  assert.ok(
    migrationCorpus.includes(`'${LEGACY_WAIVER_V1_VERSION}'`),
    "the append-only v1 waiver seed must remain available",
  );
  assert.ok(
    migrationCorpus.includes(`'${LEGACY_WAIVER_V1_BODY.replaceAll("'", "''")}'`),
    "the original v1 waiver text must remain byte-for-byte intact",
  );
  assert.ok(
    migrationCorpus.includes(`'${LEGACY_WAIVER_V1_SHA256}'`),
    "the original v1 waiver hash must remain intact",
  );
  assert.ok(
    migrationCorpus.includes(`'${LEGACY_WAIVER_V2_VERSION}'`),
    "the append-only v2 waiver seed must remain available",
  );
  assert.ok(
    migrationCorpus.includes(`'${LEGACY_WAIVER_V2_BODY.replaceAll("'", "''")}'`),
    "the original v2 waiver text must remain byte-for-byte intact",
  );
  assert.ok(
    migrationCorpus.includes(`'${LEGACY_WAIVER_V2_SHA256}'`),
    "the original v2 waiver hash must remain intact",
  );
});

test("waiver v3 retains the release scope, negligence boundary, carpool risk, and self-only eligibility", async () => {
  const model = await read(paths.model);
  const body = model.match(/BYOB_02_WAIVER_BODY\s*=\s*\n?\s*"([^"]+)"/)?.[1];

  assert.ok(body, "the displayed v3 waiver body must remain a literal contract");
  for (const party of [
    /The Ruined Project LLC/,
    /(?:United States(?: of America)?|U\.?S\.?)/,
    /(?:USDA|U\.?S\.? Department of Agriculture)[\s\S]*?Forest Service/,
    /Uinta[-–— ]Wasatch[-–— ]Cache/,
    /Pleasant Grove Ranger District/,
    /North Utah County Water Conservancy District/,
  ]) {
    assert.match(body, party, `waiver is missing released party ${party}`);
  }

  assert.match(body, /ordinary negligence/i);
  assert.match(body, /(?:does not|do not|excluding|except)[^.]*gross negligence/i);
  assert.match(body, /reckless/i);
  assert.match(body, /willful/i);
  assert.match(body, /wanton/i);
  assert.match(body, /carpool/i);
  assert.match(body, /at least 18 years old/i);
  assert.match(body, /only for myself/i);
  assert.doesNotMatch(body, /\bguest|\bgroup|guardian/i);
});

test("the exact acknowledgment remains in a collapsed native disclosure", async () => {
  const form = await read(paths.form);
  const detailsStart = form.indexOf("<details");
  const detailsEnd = form.indexOf("</details>", detailsStart);
  const disclosure = form.slice(detailsStart, detailsEnd);
  const openingTag = disclosure.match(/<details\b[^>]*>/)?.[0] ?? "";

  assert.ok(detailsStart >= 0 && detailsEnd > detailsStart);
  assert.doesNotMatch(openingTag, /\sopen(?:\s|=|>)/);
  assert.match(disclosure, /<summary\b[\s\S]*?BYOB_02_WAIVER_TITLE[\s\S]*?<\/summary>/);
  assert.match(disclosure, /\{BYOB_02_WAIVER_BODY\}/);
  assert.match(form, /name="waiverAccepted"/);
  assert.match(form, /aria-describedby=\{`\$\{fieldPrefix\}-waiver-copy`\}/);
});

test("registrant identity uses split first and last names through the additive data path", async () => {
  const [form, model, repository, migrationCorpus] = await Promise.all([
    read(paths.form),
    read(paths.model),
    read(paths.repository),
    readMigrationCorpus(),
  ]);
  const requestType = model.slice(
    model.indexOf("export type Byob02RegistrationRequest"),
    model.indexOf("export type Byob02RegistrationSubmission"),
  );
  const parser = model.slice(model.indexOf("export function parseByob02RegistrationInput"));
  const firstNameInput = form.match(/<input\b[^>]*name="firstName"[^>]*>/)?.[0];
  const lastNameInput = form.match(/<input\b[^>]*name="lastName"[^>]*>/)?.[0];
  const twoColumnRows = [...form.matchAll(
    /<div className="grid[^"]*sm:grid-cols-2[^"]*">([\s\S]*?)<\/div>/g,
  )].map((match) => match[1]);

  assert.match(requestType, /\bfirstName:\s*string/);
  assert.match(requestType, /\blastName:\s*string/);
  assert.doesNotMatch(requestType, /\bname:\s*string/);
  assert.match(parser, /normalizeName\(value\.firstName(?:,\s*\d+)?\)/);
  assert.match(parser, /normalizeName\(value\.lastName(?:,\s*\d+)?\)/);
  assert.match(parser, /registrantFirstName/);
  assert.match(parser, /registrantLastName/);

  assert.ok(firstNameInput, "first-name input must remain present");
  assert.ok(lastNameInput, "last-name input must remain present");
  assert.match(firstNameInput, /autoComplete="given-name"/);
  assert.match(lastNameInput, /autoComplete="family-name"/);
  assert.match(form, /<span className=\{FIELD_LABEL_CLASS\}>First(?: name)?<\/span>/);
  assert.match(form, /<span className=\{FIELD_LABEL_CLASS\}>Last(?: name)?<\/span>/);
  assert.ok(
    twoColumnRows.some((row) => row.includes('name="firstName"') && row.includes('name="lastName"')),
    "First and Last must share the first two-column row",
  );
  assert.ok(
    twoColumnRows.some((row) => row.includes('name="email"') && row.includes('name="instagramHandle"')),
    "Email and Instagram must share the second two-column row",
  );
  assert.match(form, /firstName:\s*data\.get\("firstName"\)/);
  assert.match(form, /lastName:\s*data\.get\("lastName"\)/);

  assert.match(
    migrationCorpus,
    /alter table\s+(?:public\.)?community_event_registrations[\s\S]*?add column if not exists registrant_first_name\s+text/i,
  );
  assert.match(
    migrationCorpus,
    /alter table\s+(?:public\.)?community_event_registrations[\s\S]*?add column if not exists registrant_last_name\s+text/i,
  );
  assert.doesNotMatch(
    migrationCorpus,
    /(?:drop|rename)\s+column\s+registrant_name/i,
    "split-name support must not destructively rewrite the existing full-name column",
  );
  assert.match(repository, /registrant_first_name/);
  assert.match(repository, /registrant_last_name/);
  assert.match(repository, /submission\.registrantFirstName/);
  assert.match(repository, /submission\.registrantLastName/);
});

test("duplicate participant registration is idempotent and never overwrites the first waiver record", async () => {
  const repository = await read(paths.repository);
  const registrationWriter = repository.slice(
    repository.indexOf("export async function registerByob02Participant"),
  );

  assert.match(
    registrationWriter,
    /on conflict\s*\(\s*event_key\s*,\s*email_normalized\s*\)\s*do nothing/i,
  );
  assert.doesNotMatch(registrationWriter, /on conflict[\s\S]{0,240}?do update/i);
  assert.doesNotMatch(registrationWriter, /update\s+community_event_registrations/i);
  assert.match(registrationWriter, /if \(!registration\) return/);
});

test("registration is self-only from the UI through persistence", async () => {
  const [api, form, model, repository] = await Promise.all([
    read(paths.api),
    read(paths.form),
    read(paths.model),
    read(paths.repository),
  ]);
  const requestType = model.slice(
    model.indexOf("export type Byob02RegistrationRequest"),
    model.indexOf("export type Byob02RegistrationSubmission"),
  );
  const submissionType = model.slice(
    model.indexOf("export type Byob02RegistrationSubmission"),
    model.indexOf("export type Byob02RegistrationSuccess"),
  );
  const registrationWriter = repository.slice(
    repository.indexOf("export async function registerByob02Participant"),
  );

  assert.match(form, /18\+ · One form per person\./);
  assert.match(form, /registering only myself/);
  assert.match(form, /\{state === "sending" \? "Registering…" : "Register"\}/);
  assert.match(form, /Your registration is recorded\./);
  assert.doesNotMatch(
    form,
    /Bringing guests|Add another guest|Remove guest|One form per group|covers your group|Every adult guest|guestFields|guestChoice|BYOB_02_MAX_GUESTS|name="guestNames"/i,
  );
  assert.match(form, /Parking is limited\.[\s\S]*?carpool when possible/i);

  assert.doesNotMatch(requestType, /bringingGuests|guestNames|\bguest/i);
  assert.doesNotMatch(submissionType, /bringingGuests|guestNames|\bguest/i);
  assert.match(model, /if \("bringingGuests" in value \|\| "guestNames" in value\) return null/);
  assert.doesNotMatch(api, /registerByob02Group|bringingGuests|guestNames/);
  assert.match(api, /registerByob02Participant/);
  assert.doesNotMatch(registrationWriter, /community_event_registration_guests|guestNames|bringingGuests/);
  assert.match(registrationWriter, /'participant',\s*'registrant'/);
  assert.match(registrationWriter, /'age_confirmation',\s*'18_or_older'/);
  assert.match(registrationWriter, /'carpool_disclosure_presented',\s*true/);
});

test("historical guest schema remains private but receives no new application writes", async () => {
  const [migrationCorpus, migrationV3, repository] = await Promise.all([
    readMigrationCorpus(),
    read(paths.migrationV3),
    read(paths.repository),
  ]);

  assert.match(
    migrationCorpus,
    /create table if not exists community_event_registration_guests/i,
  );
  assert.match(
    migrationCorpus,
    /alter table\s+(?:public\.)?community_event_registration_guests enable row level security/i,
  );
  assert.match(
    migrationCorpus,
    /revoke all on table[\s\S]*?community_event_registration_guests[\s\S]*?from public, anon, authenticated, service_role/i,
  );
  assert.doesNotMatch(repository, /community_event_registration_guests/);
  assert.doesNotMatch(
    migrationV3,
    /(?:drop|truncate|delete\s+from|update)\s+(?:table\s+)?(?:public\.)?community_event_registration_guests/i,
  );
});

test("the tank offer appears only after durable success and remains PII-free", async () => {
  const [api, form, model] = await Promise.all([
    read(paths.api),
    read(paths.form),
    read(paths.model),
  ]);
  const tankHref = "/store/byob-tank?utm_source=byob-02-registration&utm_medium=onsite&utm_campaign=byob-02";
  const successPosition = form.indexOf("You’re in.");
  const tankPosition = form.indexOf("href={TANK_CTA_HREF}");

  assert.match(
    form,
    /!response\.ok\s*\|\|\s*payload\?\.ok\s*!==\s*true|response\.ok\s*&&\s*payload\?*\.ok\s*===\s*true/,
  );
  assert.ok(successPosition >= 0, "the definitive success heading is missing");
  assert.ok(tankPosition > successPosition, "the optional tank offer should follow registration success");
  assert.match(
    form,
    /TANK_CTA_HREF\s*=\s*`\$\{BYOB_02_TANK_HREF\}\?utm_source=byob-02-registration&utm_medium=onsite&utm_campaign=byob-02`/,
  );
  assert.match(form, /View the tank/);
  assert.match(form, /href=\{`\/community#\$\{BYOB_02_EVENT_KEY\}`\}/);
  assert.match(form, /Back to BYOB Nº 02/);
  assert.doesNotMatch(tankHref, /email|name|guest|instagram|registration(?:Id|_id)/i);
  assert.match(model, /BYOB_02_TANK_HREF\s*=\s*"\/store\/byob-tank"/);
  assert.match(api, /tankHref:\s*BYOB_02_TANK_HREF|tankHref:\s*"\/store\/byob-tank"/);
});

test("the post-registration tank offer shows the responsive flat-lay product image", async () => {
  const form = await read(paths.form);
  const flatLayUrl =
    "https://cdn.shopify.com/s/files/1/1001/4077/7793/files/BYOB_Tee_Product.png?v=1787271453";
  const successBranch = form.match(
    /if \(state === "success"\) \{([\s\S]*?)\n  \}\n\n  return \(/,
  )?.[1];

  assert.ok(successBranch, "the durable-success branch must remain inspectable");
  assert.match(form, /import Image from "next\/image"/);
  assert.ok(
    form.includes(flatLayUrl),
    "the success offer should use the model-free BYOB Tank flat lay",
  );
  assert.match(successBranch, /src=\{TANK_FLAT_LAY_IMAGE\}/);
  assert.ok(
    successBranch.indexOf("src={TANK_FLAT_LAY_IMAGE}") <
      successBranch.indexOf("Optional"),
    "the product should be visible before its purchase details on mobile",
  );

  const tankImage = successBranch.match(
    /<Image\b[\s\S]*?src=\{TANK_FLAT_LAY_IMAGE\}[\s\S]*?\/>/,
  )?.[0];
  assert.ok(tankImage, "the flat-lay image should remain inside the durable-success offer");
  const flatLayAlt = form.match(
    /const TANK_FLAT_LAY_ALT\s*=\s*\n?\s*"([^"]+)"/,
  )?.[1];
  assert.ok(flatLayAlt, "the flat-lay alt text must remain inspectable");
  assert.match(
    flatLayAlt,
    /BYOB Tank.*(?:front.*back|back.*front)/i,
    "the product image needs descriptive front-and-back alt text",
  );
  assert.match(tankImage, /alt=\{TANK_FLAT_LAY_ALT\}/);
  assert.match(tankImage, /\sfill(?:\s|\/?>)/);
  assert.match(
    tankImage,
    /sizes="\(min-width: 640px\) 20rem, calc\(100vw - 2rem\)"/,
  );
  assert.match(tankImage, /className="[^"]*object-cover[^"]*"/);
  assert.match(successBranch, /href=\{TANK_CTA_HREF\}/);
  assert.match(successBranch, /\$32 · Preorder · Ships September/);
  assert.doesNotMatch(successBranch, /Ships September\s+\d/);
});

test("registration neither opts people into marketing nor invokes Shopify purchase state", async () => {
  const [api, form, repository] = await Promise.all([
    read(paths.api),
    read(paths.form),
    read(paths.repository),
  ]);
  const registrationSurface = `${api}\n${form}\n${repository}`;

  assert.doesNotMatch(registrationSurface, /\/api\/communications\/subscribe/);
  assert.doesNotMatch(registrationSurface, /marketing(?:Consent|OptIn|_consent|_opt_in)/i);
  assert.doesNotMatch(registrationSurface, /\/api\/store\/checkout/);
  assert.doesNotMatch(
    registrationSurface,
    /createCheckoutUrl|addBagItem|useBag|from\s+["'][^"']*shopify/i,
  );
  assert.doesNotMatch(form, /window\.location\.(?:assign|replace)|router\.(?:push|replace)\([^)]*store/);
});
