// google-sheet.js
// Safe Google Sheet integration with dynamic import (no crash if library missing)

export async function getCustomersFromSheet(force = false) {
  const SHEET_ID = process.env.SHEET_ID || "";
  const TAB_NAME = process.env.SHEET_TAB_NAME || "Sheet1";
  const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY || "";

  if (PRIVATE_KEY.includes("\\n")) {
    PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, "\n");
  }

  if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
    console.warn("Google Sheet: Missing environment variables");
    return [];
  }

  try {
    // dynamic import to avoid crash if library missing
    const { GoogleSpreadsheet } = await import("google-spreadsheet");
    const doc = new GoogleSpreadsheet(SHEET_ID);

    await doc.useServiceAccountAuth({
      client_email: SERVICE_ACCOUNT_EMAIL,
      private_key: PRIVATE_KEY,
    });

    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[TAB_NAME] || doc.sheetsByIndex[0];
    if (!sheet) {
      console.warn("Google Sheet tab not found:", TAB_NAME);
      return [];
    }

    const rows = await sheet.getRows();
    return rows.map((row) => ({
      id: row.id || null,
      name: row.name || "",
      phone: row.phone || "",
      email: row.email || "",
      created_at: row.created_at || null,
    }));
  } catch (err) {
    console.error("Google Sheet error:", err.message);
    return [];
  }
}

export default { getCustomersFromSheet };
