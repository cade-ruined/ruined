import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/google/sheets.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const baseEnvironment = {
  GOOGLE_REGISTRATION_SHEET_ENABLED: "true",
  GOOGLE_REGISTRATION_SPREADSHEET_ID: "registration-sheet",
};
const federationEnvironment = {
  GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER:
    "projects/123456789/locations/global/workloadIdentityPools/ruined-byob/providers/vercel",
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "registrations@ruined-test.iam.gserviceaccount.com",
};
const legacyCredentials = Buffer.from(JSON.stringify({
  type: "service_account",
  client_email: "registrations@ruined-test.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\ntest-fixture-only\n-----END PRIVATE KEY-----",
})).toString("base64");

function fixture(environment = {}) {
  const authOptions = [];
  const federationOptions = [];
  const oidcCalls = [];
  const subjectTokens = [];
  const requests = [];
  let nextToken = "first-request-token";

  class MockIdentityPoolClient {
    constructor(options) {
      this.options = options;
      federationOptions.push(options);
    }
    async retrieveSubjectToken() {
      return this.options.subject_token_supplier.getSubjectToken({
        audience: this.options.audience,
        subjectTokenType: this.options.subject_token_type,
      });
    }
  }
  class MockGoogleAuth {
    constructor(options) {
      this.options = options;
      authOptions.push(options);
    }
    async request(options) {
      requests.push(options);
      if (this.options.authClient) {
        subjectTokens.push(await this.options.authClient.retrieveSubjectToken());
      }
      return { data: { values: [["existing row"]] } };
    }
  }
  const dependencies = {
    "server-only": {},
    "node:buffer": { Buffer },
    "google-auth-library": {
      GoogleAuth: MockGoogleAuth,
      IdentityPoolClient: MockIdentityPoolClient,
    },
    "@vercel/oidc": {
      async getVercelOidcToken(...args) {
        oidcCalls.push(args);
        return nextToken;
      },
    },
  };
  const cjsModule = { exports: {} };
  // Execute the real provider module with an isolated environment/cache and
  // auth transport. No real credentials or external requests are available.
  new Function("require", "module", "exports", "process", "globalThis", compiled)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports, { env: { ...baseEnvironment, ...environment } }, {});

  return {
    client: cjsModule.exports,
    authOptions,
    federationOptions,
    oidcCalls,
    subjectTokens,
    requests,
    setToken(token) { nextToken = token; },
  };
}

test("keyless configuration is ready without a stored credential or request token", () => {
  const { client, oidcCalls, authOptions } = fixture(federationEnvironment);
  assert.deepEqual(client.getGoogleRegistrationSheetConfigurationStatus(), {
    enabled: true,
    missing: [],
    ready: true,
    spreadsheetId: "registration-sheet",
  });
  assert.equal(oidcCalls.length, 0);
  assert.equal(authOptions.length, 0);
});

test("partial or invalid federation fails closed even when legacy credentials exist", async () => {
  const cases = [
    [{ GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER: "" }, "GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER"],
    [{ GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "" }, "GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL"],
    [{ GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER: "https://untrusted.example/provider" }, "GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER (invalid)"],
    [{ GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER: "projects/123/locations/global/workloadIdentityPools/p/providers/p?redirect=elsewhere" }, "GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER (invalid)"],
    [{ GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "person@example.com" }, "GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL (invalid)"],
    [{ GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "account@project.iam.gserviceaccount.com/other" }, "GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL (invalid)"],
  ];
  for (const [overrides, expected] of cases) {
    const { client, authOptions } = fixture({
      ...federationEnvironment,
      ...overrides,
      GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64: legacyCredentials,
    });
    const status = client.getGoogleRegistrationSheetConfigurationStatus();
    assert.equal(status.ready, false);
    assert.deepEqual(status.missing, [expected]);
    await assert.rejects(client.getGoogleSheetValues("registration-sheet", "Registrants!I2:I"), /workload identity is not configured/);
    assert.equal(authOptions.length, 0);
  }
});

test("federation uses the Sheets scope and resolves each requested subject token lazily", async () => {
  const state = fixture({
    ...federationEnvironment,
    // The chosen keyless mode does not depend on an unused legacy credential.
    GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64: "invalid-unused-legacy-value",
  });
  assert.equal(state.client.getGoogleRegistrationSheetConfigurationStatus().ready, true);
  assert.equal(state.oidcCalls.length, 0);

  assert.deepEqual(await state.client.getGoogleSheetValues("registration-sheet", "Registrants!I2:I"), [["existing row"]]);
  state.setToken("second-request-token");
  await state.client.getGoogleSheetValues("registration-sheet", "Registrants!I2:I");

  assert.equal(state.authOptions.length, 1, "the auth client may cache Google access tokens");
  assert.equal(state.federationOptions.length, 1);
  const options = state.federationOptions[0];
  assert.equal(options.type, "external_account");
  assert.equal(options.audience, `//iam.googleapis.com/${federationEnvironment.GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER}`);
  assert.equal(options.subject_token_type, "urn:ietf:params:oauth:token-type:jwt");
  assert.equal(options.token_url, "https://sts.googleapis.com/v1/token");
  assert.equal(options.service_account_impersonation_url, `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${federationEnvironment.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`);
  assert.deepEqual(options.scopes, ["https://www.googleapis.com/auth/spreadsheets"]);
  assert.equal(options.credential_source, undefined);
  assert.equal(state.authOptions[0].credentials, undefined);
  assert.deepEqual(state.subjectTokens, ["first-request-token", "second-request-token"]);
  assert.deepEqual(state.oidcCalls, [[], []], "Google's audience must not be forwarded into Vercel custom-audience options");
  assert.equal(state.requests.length, 2);
});

test("legacy credentials remain supported when both federation settings are empty", async () => {
  const { client, authOptions, federationOptions, oidcCalls } = fixture({
    GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64: legacyCredentials,
  });
  assert.equal(client.getGoogleRegistrationSheetConfigurationStatus().ready, true);
  await client.getGoogleSheetValues("registration-sheet", "Registrants!I2:I");
  assert.equal(authOptions[0].credentials.type, "service_account");
  assert.deepEqual(authOptions[0].scopes, ["https://www.googleapis.com/auth/spreadsheets"]);
  assert.equal(federationOptions.length, 0);
  assert.equal(oidcCalls.length, 0);

  assert.deepEqual(fixture().client.getGoogleRegistrationSheetConfigurationStatus().missing, [
    "GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64",
  ]);
  assert.deepEqual(fixture({
    GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64: "invalid",
  }).client.getGoogleRegistrationSheetConfigurationStatus().missing, [
    "GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64 (invalid)",
  ]);
});

test("federation does not bypass the enable switch or spreadsheet validation", () => {
  const { client } = fixture({
    ...federationEnvironment,
    GOOGLE_REGISTRATION_SHEET_ENABLED: "false",
    GOOGLE_REGISTRATION_SPREADSHEET_ID: "invalid/spreadsheet",
  });
  const status = client.getGoogleRegistrationSheetConfigurationStatus();
  assert.equal(status.ready, false);
  assert.deepEqual(status.missing, [
    "GOOGLE_REGISTRATION_SHEET_ENABLED",
    "GOOGLE_REGISTRATION_SPREADSHEET_ID (invalid)",
  ]);
});
