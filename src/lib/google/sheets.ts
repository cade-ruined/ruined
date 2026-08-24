import "server-only";

import { Buffer } from "node:buffer";

import { GoogleAuth } from "google-auth-library";

const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_SHEETS_API_ROOT = "https://sheets.googleapis.com/v4/spreadsheets";
const REQUEST_TIMEOUT_MS = 10_000;

export type GoogleSheetCellValue = string | number | boolean;
export type GoogleSheetRow = GoogleSheetCellValue[];

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  project_id?: string;
  type: "service_account";
};

type GoogleValuesResponse = {
  values?: unknown[][];
};

type GoogleAppendValuesResponse = {
  updates?: {
    updatedRange?: string;
  };
};

type GoogleGridRange = {
  endColumnIndex?: number;
  endRowIndex?: number;
  sheetId?: number;
  startColumnIndex?: number;
  startRowIndex?: number;
};

type GoogleSpreadsheetMetadataResponse = {
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
    };
    tables?: Array<{
      range?: GoogleGridRange;
      tableId?: string;
    }>;
  }>;
};

declare global {
  var ruinedGoogleSheetsAuth: GoogleAuth | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseServiceAccountCredentials(encoded: string): ServiceAccountCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as unknown;
  } catch {
    throw new Error("Google Sheets service account credentials are invalid.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Google Sheets service account credentials are invalid.");
  }

  const clientEmail = parsed.client_email;
  const privateKey = parsed.private_key;
  const privateKeyId = parsed.private_key_id;
  const projectId = parsed.project_id;

  if (
    parsed.type !== "service_account"
    || typeof clientEmail !== "string"
    || !clientEmail.endsWith(".gserviceaccount.com")
    || typeof privateKey !== "string"
    || !privateKey.includes("-----BEGIN PRIVATE KEY-----")
    || !privateKey.includes("-----END PRIVATE KEY-----")
    || (privateKeyId !== undefined && typeof privateKeyId !== "string")
    || (projectId !== undefined && typeof projectId !== "string")
  ) {
    throw new Error("Google Sheets service account credentials are invalid.");
  }

  return {
    type: "service_account",
    client_email: clientEmail,
    private_key: privateKey,
    ...(privateKeyId ? { private_key_id: privateKeyId } : {}),
    ...(projectId ? { project_id: projectId } : {}),
  };
}

function requireSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_REGISTRATION_SPREADSHEET_ID?.trim();
  if (!spreadsheetId || !/^[A-Za-z0-9_-]+$/.test(spreadsheetId)) {
    throw new Error("Google registration spreadsheet ID is not configured.");
  }
  return spreadsheetId;
}

function getGoogleSheetsAuth(): GoogleAuth {
  if (globalThis.ruinedGoogleSheetsAuth) return globalThis.ruinedGoogleSheetsAuth;

  const encoded = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (!encoded) {
    throw new Error("Google Sheets service account credentials are not configured.");
  }

  const credentials = parseServiceAccountCredentials(encoded);
  globalThis.ruinedGoogleSheetsAuth = new GoogleAuth({
    credentials,
    scopes: [GOOGLE_SHEETS_SCOPE],
  });
  return globalThis.ruinedGoogleSheetsAuth;
}

function spreadsheetUrl(spreadsheetId: string, suffix = ""): string {
  return `${GOOGLE_SHEETS_API_ROOT}/${encodeURIComponent(spreadsheetId)}${suffix}`;
}

function valuesUrl(spreadsheetId: string, range: string, suffix = ""): string {
  return spreadsheetUrl(
    spreadsheetId,
    `/values/${encodeURIComponent(range)}${suffix}`,
  );
}

function normalizeRows(values: unknown[][] | undefined): GoogleSheetRow[] {
  if (!values) return [];
  return values.map((row) => row.map((cell) => {
    if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") {
      return cell;
    }
    return "";
  }));
}

export function getGoogleRegistrationSheetConfigurationStatus(): {
  enabled: boolean;
  missing: string[];
  ready: boolean;
  spreadsheetId: string | null;
} {
  const enabled = process.env.GOOGLE_REGISTRATION_SHEET_ENABLED === "true";
  const spreadsheetId = process.env.GOOGLE_REGISTRATION_SPREADSHEET_ID?.trim() || null;
  const encodedCredentials =
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64?.trim() || null;
  const missing = [
    ...(!enabled ? ["GOOGLE_REGISTRATION_SHEET_ENABLED"] : []),
    ...(!spreadsheetId ? ["GOOGLE_REGISTRATION_SPREADSHEET_ID"] : []),
    ...(!encodedCredentials ? ["GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64"] : []),
  ];

  if (spreadsheetId && !/^[A-Za-z0-9_-]+$/.test(spreadsheetId)) {
    missing.push("GOOGLE_REGISTRATION_SPREADSHEET_ID (invalid)");
  }
  if (encodedCredentials) {
    try {
      parseServiceAccountCredentials(encodedCredentials);
    } catch {
      missing.push("GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_BASE64 (invalid)");
    }
  }

  return {
    enabled,
    missing,
    ready: missing.length === 0,
    spreadsheetId,
  };
}

export function getGoogleRegistrationSpreadsheetId(): string {
  return requireSpreadsheetId();
}

export async function getGoogleSheetValues(
  spreadsheetId: string,
  range: string,
): Promise<GoogleSheetRow[]> {
  const response = await getGoogleSheetsAuth().request<GoogleValuesResponse>({
    method: "GET",
    timeout: REQUEST_TIMEOUT_MS,
    url: valuesUrl(spreadsheetId, range),
  });
  return normalizeRows(response.data.values);
}

export async function updateGoogleSheetValues(
  spreadsheetId: string,
  range: string,
  values: GoogleSheetRow[],
): Promise<void> {
  await getGoogleSheetsAuth().request({
    data: {
      majorDimension: "ROWS",
      range,
      values,
    },
    method: "PUT",
    params: { valueInputOption: "RAW" },
    timeout: REQUEST_TIMEOUT_MS,
    url: valuesUrl(spreadsheetId, range),
  });
}

export async function appendGoogleSheetValues(
  spreadsheetId: string,
  range: string,
  values: GoogleSheetRow[],
): Promise<string | null> {
  const response = await getGoogleSheetsAuth().request<GoogleAppendValuesResponse>({
    data: {
      majorDimension: "ROWS",
      range,
      values,
    },
    method: "POST",
    params: {
      insertDataOption: "INSERT_ROWS",
      valueInputOption: "RAW",
    },
    timeout: REQUEST_TIMEOUT_MS,
    url: valuesUrl(spreadsheetId, range, ":append"),
  });
  return response.data.updates?.updatedRange ?? null;
}

export async function clearGoogleSheetValues(
  spreadsheetId: string,
  range: string,
): Promise<void> {
  await getGoogleSheetsAuth().request({
    data: {},
    method: "POST",
    timeout: REQUEST_TIMEOUT_MS,
    url: valuesUrl(spreadsheetId, range, ":clear"),
  });
}

async function getGoogleSheetMetadata(
  spreadsheetId: string,
  sheetTitle: string,
): Promise<{
  sheetId: number;
  tables: NonNullable<GoogleSpreadsheetMetadataResponse["sheets"]>[number]["tables"];
}> {
  const metadata = await getGoogleSheetsAuth().request<GoogleSpreadsheetMetadataResponse>({
    method: "GET",
    params: { fields: "sheets(properties(sheetId,title),tables(tableId,range))" },
    timeout: REQUEST_TIMEOUT_MS,
    url: spreadsheetUrl(spreadsheetId),
  });
  const sheet = metadata.data.sheets
    ?.find((candidate) => candidate.properties?.title === sheetTitle);
  const sheetId = sheet?.properties?.sheetId;
  if (typeof sheetId !== "number" || !Number.isInteger(sheetId)) {
    throw new Error("Google registration sheet tab is missing.");
  }
  return { sheetId, tables: sheet?.tables };
}

export async function configureGoogleRegistrationSheet(
  spreadsheetId: string,
  sheetTitle: string,
): Promise<void> {
  const { sheetId } = await getGoogleSheetMetadata(spreadsheetId, sheetTitle);

  await getGoogleSheetsAuth().request({
    data: {
      requests: [
        {
          updateSpreadsheetProperties: {
            fields: "timeZone",
            properties: { timeZone: "America/Denver" },
          },
        },
        {
          repeatCell: {
            cell: {
              userEnteredFormat: {
                numberFormat: {
                  pattern: "mmm d, yyyy h:mm am/pm",
                  type: "DATE_TIME",
                },
              },
            },
            fields: "userEnteredFormat.numberFormat",
            range: {
              endColumnIndex: 1,
              sheetId,
              startColumnIndex: 0,
              startRowIndex: 1,
            },
          },
        },
        {
          repeatCell: {
            cell: {
              userEnteredFormat: {
                numberFormat: {
                  pattern: "mmm d, yyyy h:mm am/pm",
                  type: "DATE_TIME",
                },
              },
            },
            fields: "userEnteredFormat.numberFormat",
            range: {
              endColumnIndex: 7,
              sheetId,
              startColumnIndex: 6,
              startRowIndex: 1,
            },
          },
        },
      ],
    },
    method: "POST",
    timeout: REQUEST_TIMEOUT_MS,
    url: spreadsheetUrl(spreadsheetId, ":batchUpdate"),
  });
}

export async function hideGoogleSheetColumn(
  spreadsheetId: string,
  sheetTitle: string,
  zeroBasedColumnIndex: number,
): Promise<void> {
  if (!Number.isInteger(zeroBasedColumnIndex) || zeroBasedColumnIndex < 0) {
    throw new Error("Google registration sheet column index is invalid.");
  }

  const { sheetId } = await getGoogleSheetMetadata(spreadsheetId, sheetTitle);
  await getGoogleSheetsAuth().request({
    data: {
      requests: [
        {
          updateDimensionProperties: {
            fields: "hiddenByUser",
            properties: { hiddenByUser: true },
            range: {
              dimension: "COLUMNS",
              endIndex: zeroBasedColumnIndex + 1,
              sheetId,
              startIndex: zeroBasedColumnIndex,
            },
          },
        },
      ],
    },
    method: "POST",
    timeout: REQUEST_TIMEOUT_MS,
    url: spreadsheetUrl(spreadsheetId, ":batchUpdate"),
  });
}

export async function extendGoogleSheetTableToRow(
  spreadsheetId: string,
  sheetTitle: string,
  endRowIndex: number,
): Promise<void> {
  if (!Number.isInteger(endRowIndex) || endRowIndex < 1) {
    throw new Error("Google registration table range is invalid.");
  }

  const { sheetId, tables } = await getGoogleSheetMetadata(spreadsheetId, sheetTitle);
  const table = tables?.find((candidate) => {
    const range = candidate.range;
    return candidate.tableId
      && range?.sheetId === sheetId
      && (range.startRowIndex ?? 0) === 0
      && (range.startColumnIndex ?? 0) === 0
      && (range.endColumnIndex ?? 0) >= 9;
  });
  const range = table?.range;
  if (!table?.tableId || !range || (range.endRowIndex ?? 0) >= endRowIndex) return;

  await getGoogleSheetsAuth().request({
    data: {
      requests: [
        {
          updateTable: {
            fields: "range",
            table: {
              range: {
                ...range,
                endRowIndex,
                sheetId,
              },
              tableId: table.tableId,
            },
          },
        },
      ],
    },
    method: "POST",
    timeout: REQUEST_TIMEOUT_MS,
    url: spreadsheetUrl(spreadsheetId, ":batchUpdate"),
  });
}
