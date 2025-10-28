// google-sheet.js
// ES module — استخدام مع import
import { google } from "googleapis";

/**
 * Helper to interact with Google Sheets using a service account loaded from env vars:
 * - GOOGLE_SERVICE_ACCOUNT_EMAIL
 * - GOOGLE_PRIVATE_KEY (newlines may be escaped; this code normalizes them)
 * - SHEET_ID
 * - SHEET_TAB_NAME
 */

function getAuthClient() {
  const client_email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let private_key = process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY_RAW;

  if (!client_email || !private_key) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY environment variables");
  }

  // Private key may be stored with literal \n; convert to real newlines
  private_key = private_key.replace(/\\n/g, "\n");

  const jwtClient = new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return jwtClient;
}

async function getSheetsClient() {
  const auth = getAuthClient();
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

/**
 * Read rows from the configured sheet/tab and return as array of objects.
 * The first row is assumed to be the header (column names).
 */
export async function readSheetRows() {
  const sheetId = process.env.SHEET_ID;
  const tab = process.env.SHEET_TAB_NAME || "Sheet1";
  if (!sheetId) throw new Error("Missing SHEET_ID env var");

  const sheets = await getSheetsClient();
  const range = `${tab}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });

  const rows = res.data.values || [];
  if (rows.length === 0) return [];

  // assume first row is header
  const headers = rows[0].map((h) => String(h).trim());
  const dataRows = rows.slice(1);

  const result = dataRows.map((r) => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i] || `col${i + 1}`] = r[i] !== undefined ? r[i] : null;
    }
    return obj;
  });

  return result;
}

/**
 * Append a row to sheet. `obj` can be an object or array.
 * If object — converts to values in header order (if header present),
 * otherwise appends values in insertion order.
 */
export async function appendSheetRow(obj) {
  const sheetId = process.env.SHEET_ID;
  const tab = process.env.SHEET_TAB_NAME || "Sheet1";
  if (!sheetId) throw new Error("Missing SHEET_ID env var");

  const sheets = await getSheetsClient();

  // if obj is object, try to align to headers
  let values;
  if (Array.isArray(obj)) {
    values = obj;
  } else if (typeof obj === "object" && obj !== null) {
    // read headers
    const headRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tab}!1:1`,
    });
    const headers = (headRes.data.values && headRes.data.values[0]) || Object.keys(obj);
    values = headers.map((h) => (obj[h] !== undefined && obj[h] !== null ? String(obj[h]) : ""));
  } else {
    // primitive
    values = [String(obj)];
  }

  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: tab,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [values],
    },
  });

  return appendRes.data;
}
