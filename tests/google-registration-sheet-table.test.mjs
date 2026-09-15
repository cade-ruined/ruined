import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/google/sheets.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test("the existing Registrants table gains Event J and grows without shrinking or replacement", async () => {
  const table = { tableId: "existing-registration-table", range: {
    sheetId: 42, startRowIndex: 0, startColumnIndex: 0, endRowIndex: 16, endColumnIndex: 9,
  } };
  const requests = [];
  class MockGoogleAuth {
    async request(request) {
      requests.push(request);
      if (request.method === "GET") return { data: { sheets: [{
        properties: { sheetId: 42, title: "Registrants" }, tables: [table],
      }] } };
      const updates = request.data.requests;
      assert.equal(updates.length, 1);
      assert.equal(updates[0].updateTable.fields, "range");
      assert.equal(updates[0].updateTable.table.tableId, table.tableId);
      table.range = updates[0].updateTable.table.range;
      return { data: {} };
    }
  }
  const dependencies = { "server-only": {}, "node:buffer": { Buffer }, "google-auth-library": { GoogleAuth: MockGoogleAuth } };
  const loaded = { exports: {} };
  const credentials = Buffer.from(JSON.stringify({
    type: "service_account", client_email: "registrations@fixture.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nfixture-only\n-----END PRIVATE KEY-----",
  })).toString("base64");
  // The real provider code runs with isolated credentials/cache and a fake transport.
  new Function("require", "module", "exports", "process", "globalThis", compiled)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, { env: { GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64: credentials } }, {});
  const client = loaded.exports;
  await client.extendGoogleSheetTableToRow("registration-sheet", "Registrants", 1, 10);
  assert.deepEqual(table.range, {
    sheetId: 42, startRowIndex: 0, startColumnIndex: 0, endRowIndex: 16, endColumnIndex: 10,
  });
  await client.extendGoogleSheetTableToRow("registration-sheet", "Registrants", 17, 10);
  assert.equal(table.range.endRowIndex, 17);
  assert.equal(table.range.endColumnIndex, 10);
  const writes = () => requests.filter((request) => request.method === "POST");
  assert.equal(writes().length, 2);
  await client.extendGoogleSheetTableToRow("registration-sheet", "Registrants", 2, 9);
  assert.equal(writes().length, 2);
  assert.equal(table.range.endRowIndex, 17);
  assert.equal(table.range.endColumnIndex, 10);
  assert.doesNotMatch(JSON.stringify(writes()), /addTable|deleteTable|columnProperties|rowProperties|values/);
});
