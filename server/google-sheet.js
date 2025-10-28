// google-sheet.js
import { google } from "googleapis";

/**
 * Environment variables required:
 * - GOOGLE_SERVICE_ACCOUNT_EMAIL
 * - GOOGLE_PRIVATE_KEY
 * - SHEET_ID
 * - SHEET_TAB_NAME (optional, default "Sheet1")
 */

function getAuthClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || "";
  if (!clientEmail || !privateKey) {
    throw new Error("Google service account credentials missing (GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY)");
  }
  // privateKey might contain escaped newlines (\n). Convert them.
  privateKey = privateKey.replace(/\\n/g, "\n");
  const jwt = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return jwt;
}

function getSheets() {
  const auth = getAuthClient();
  return google.sheets({ version: "v4", auth });
}

export async function readSheetRows() {
  const sheets = getSheets();
  const spreadsheetId = process.env.SHEET_ID;
  const tab = process.env.SHEET_TAB_NAME || "Sheet1";
  if (!spreadsheetId) throw new Error("SHEET_ID not set");
  const range = `${tab}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  const rows = res.data.values || [];
  // First row may be header
  const headers = rows[0] || [];
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c] !== undefined ? row[c] : "";
    }
    data.push(obj);
  }
  return data;
}

export async function appendSheetRow(body = {}) {
  const sheets = getSheets();
  const spreadsheetId = process.env.SHEET_ID;
  const tab = process.env.SHEET_TAB_NAME || "Sheet1";
  if (!spreadsheetId) throw new Error("SHEET_ID not set");
  // Try to use header order if present; otherwise append unordered.
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!1:1`,
  });
  const headers = (headerRes.data.values && headerRes.data.values[0]) || [];
  let valuesRow = [];
  if (headers.length === 0) {
    // No headers: create headers from body keys then append
    const keys = Object.keys(body);
    if (keys.length === 0) {
      throw new Error("No headers and body empty");
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: tab,
      valueInputOption: "RAW",
      requestBody: { values: [keys] },
    });
    valuesRow = keys.map((k) => (body[k] !== undefined ? body[k] : ""));
  } else {
    valuesRow = headers.map((h) => {
      // case-insensitive match
      const found = Object.keys(body).find((k) => String(k).toLowerCase() === String(h).toLowerCase());
      return found ? body[found] : "";
    });
  }

  const resp = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: tab,
    valueInputOption: "RAW",
    requestBody: { values: [valuesRow] },
  });
  return resp.data;
}
