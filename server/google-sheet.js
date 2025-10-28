// google-sheet.js
// Safe Google Sheet helper — uses dynamic import so service keeps running if package missing.

export async function getCustomersFromSheet(force = false) {
  const SHEET_ID = process.env.SHEET_ID || "";
  const TAB_NAME = process.env.SHEET_TAB_NAME || "Sheet1";
  const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY || "";

  if (PRIVATE_KEY && PRIVATE_KEY.indexOf("\\n") !== -1) {
    PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, "\n");
  }

  if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
    console.warn("google-sheet: missing env config; returning []");
    return [];
  }

  try {
    // dynamic import: avoids crash if google-spreadsheet is not installed
    const mod = await import("google-spreadsheet");
    const { GoogleSpreadsheet } = mod;
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

    const rows = await sheet.getRows();
    const data = rows.map((r) => {
      const obj = {};
      for (const k of Object.keys(r)) {
        if (k.startsWith("_")) continue;
        obj[k] = typeof r[k] === "string" ? r[k].trim() : r[k];
      }
      return obj;
    });

    return data;
  } catch (err) {
    console.error("google-sheet: dynamic import/read error:", err && err.message ? err.message : err);
    return [];
  }
}

export default { getCustomersFromSheet };
