// google-sheet.js
// Utility to read a Google Sheet using a Service Account
// Exports: async function getCustomersFromSheet(force = false) => returns array of row objects

import { GoogleSpreadsheet } from "google-spreadsheet";

const SHEET_ID = process.env.SHEET_ID || "";
const TAB_NAME = process.env.SHEET_TAB_NAME || "Sheet1";
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY || "";

if (PRIVATE_KEY && PRIVATE_KEY.indexOf("\\n") !== -1) {
  // Render and some env systems store newlines as literal "\n" — convert them
  PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, "\n");
}

if (!SHEET_ID) {
  console.warn("google-sheet: SHEET_ID is not set; Google Sheet integration disabled.");
}

if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
  console.warn("google-sheet: service account credentials missing; Google Sheet integration disabled.");
}

let cached = {
  ts: 0,
  data: null,
};

const CACHE_TTL_MS = 30 * 1000; // cache for 30s (tweak if needed)

/**
 * Normalize a Google Spreadsheet row (GoogleSpreadsheetRow) into a plain object.
 * Removes internal properties and trims whitespace.
 */
function normalizeRow(row) {
  const obj = {};
  for (const k of Object.keys(row)) {
    if (k.startsWith("_")) continue; // internal fields
    // row[k] might be a getter; just copy
    obj[k] = typeof row[k] === "string" ? row[k].trim() : row[k];
  }
  return obj;
}

/**
 * Read rows from the sheet and return them as array of objects.
 * If force === true, ignore cache.
 */
export async function getCustomersFromSheet(force = false) {
  if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
    // Integration not configured; return empty array to allow fallback
    return [];
  }

  const now = Date.now();
  if (!force && cached.data && now - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const doc = new GoogleSpreadsheet(SHEET_ID);

    await doc.useServiceAccountAuth({
      client_email: SERVICE_ACCOUNT_EMAIL,
      private_key: PRIVATE_KEY,
    });

    await doc.loadInfo();

    const sheet = doc.sheetsByTitle[TAB_NAME] || doc.sheetsByIndex[0];
    if (!sheet) {
      console.warn("google-sheet: tab not found:", TAB_NAME);
      return [];
    }

    // load header values and rows
    // using getRows() returns GoogleSpreadsheetRow objects
    const rows = await sheet.getRows();

    // normalize rows to plain objects
    const data = rows.map(normalizeRow);

    // cache
    cached = { ts: now, data };

    return data;
  } catch (err) {
    // don't throw — return empty array so caller can fallback to DB
    console.error("google-sheet: error reading sheet:", err.message || err);
    return [];
  }
}

// default export for compatibility
export default { getCustomersFromSheet };
