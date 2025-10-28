// google-sheet.js
// Utility to read a Google Sheet using service account credentials
import { GoogleSpreadsheet } from "google-spreadsheet";

const SHEET_ID = process.env.SHEET_ID || "";
const TAB_NAME = process.env.SHEET_TAB_NAME || "Sheet1";
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY || "";

if (PRIVATE_KEY && PRIVATE_KEY.indexOf("\\n") !== -1) {
  // render/two panels often stores newlines as literal "\n" — convert them
  PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, "\n");
}

if (!SHEET_ID) {
  console.warn("SHEET_ID is not set. Google Sheet integration will be disabled.");
}

if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
  console.warn("Google service account credentials missing. Google Sheet integration will be disabled.");
}

let cached = {
  ts: 0,
  data: null,
};

const CACHE_TTL_MS = 60 * 1000; // 1 minute cache to reduce API hits (adjust if needed)

export async function getCustomersFromSheet(force = false) {
  if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
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

    await doc.loadInfo(); // loads document properties and worksheets
    const sheet = doc.sheetsByTitle[TAB_NAME] || doc.sheetsByIndex[0];
    if (!sheet) {
      console.warn("Google Sheet: tab not found:", TAB_NAME);
      return [];
    }

    // Load rows (you can pass { limit: 1000 } if large)
    const rows = await sheet.getRows();
    // Convert rows to plain objects. The google-spreadsheet rows map headers to properties.
    const result = rows.map((r) => {
      // Remove internal fields and convert to simple object
      const obj = {};
      for (const k of Object.keys(r)) {
        if (k === "_rawData") continue;
        if (k.startsWith("_")) continue;
        // value normalization
        obj[k] = r[k];
      }
      return obj;
    });

    // cache and return
    cached = { ts: now, data: result };
    return result;
  } catch (err) {
    console.error("Error reading Google Sheet:", err.message || err);
    return [];
  }
}
