// google-sheet.js
// Uses googleapis (official) and a service account (JWT) to read/append rows.
// Exports: readSheetRows(), appendSheetRow(obj)
//
// Required env vars:
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY (may contain literal \n newlines OR real newlines — code handles both)
// - SHEET_ID
// - SHEET_TAB_NAME (optional, defaults to first sheet or "Sheet1")

import { google } from "googleapis";

/** Create and return an authorized sheets client */
function getSheetsClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || "";

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Missing Google service account credentials. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in environment."
    );
  }

  // If the private key was copied/pasted with escaped newlines, convert them.
  privateKey = privateKey.replace(/\\n/g, "\n");

  const jwtClient = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth: jwtClient });
  return { sheets, auth: jwtClient };
}

/** Read rows and return array of objects (header -> value) */
export async function readSheetRows() {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID environment variable is not set.");

  const { sheets, auth } = getSheetsClient();
  // Authorize (ensures token)
  await auth.authorize();

  const tab = process.env.SHEET_TAB_NAME || ""; // if empty, use A:Z range without explicit tab
  // get values
  const range = tab ? `${tab}` : undefined;

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: range || undefined,
    majorDimension: "ROWS",
  });

  const values = resp.data.values || [];
  if (values.length === 0) return [];

  // First row are headers
  const headers = values[0].map((h) => (h ? String(h).trim() : ""));

  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const rowArr = values[r];
    // build object mapped from headers
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] || `col_${c}`;
      obj[key] = rowArr[c] !== undefined ? rowArr[c] : null;
    }
    rows.push(obj);
  }
  return rows;
}

/** Append one row. Accept body as object; columns determined by header row order.
 *  Returns the API response.
 */
export async function appendSheetRow(body) {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID environment variable is not set.");

  const { sheets, auth } = getSheetsClient();
  await auth.authorize();

  const tab = process.env.SHEET_TAB_NAME || ""; // if provided, use it; else will append to first sheet

  // read header row to know column order
  const headerRange = tab ? `${tab}!1:1` : `1:1`;
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: headerRange,
    majorDimension: "ROWS",
  });

  const headers = (headerResp.data.values && headerResp.data.values[0]) || [];

  // If there are no headers, create headers from body keys (ordered)
  let valuesRow = [];
  if (!headers || headers.length === 0) {
    const keys = Object.keys(body);
    // first write the headers row
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: tab || undefined,
      valueInputOption: "RAW",
      requestBody: { values: [keys] },
    });
    // then prepare values in that order
    valuesRow = keys.map((k) => (body[k] !== undefined ? body[k] : ""));
  } else {
    // use header order to map body
    valuesRow = headers.map((h) => {
      // try to find by exact header name
      if (Object.prototype.hasOwnProperty.call(body, h)) return body[h];
      // fallback: try lowercased match
      const foundKey = Object.keys(body).find((k) => String(k).toLowerCase() === String(h).toLowerCase());
      if (foundKey) return body[foundKey];
      return "";
    });
  }

  const appendResp = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: tab || undefined,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [valuesRow],
    },
  });

  return appendResp.data;
}
