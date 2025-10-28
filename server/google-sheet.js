// server/google-sheet.js
// Google Sheets integration compatible with google-spreadsheet v5.x+

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export async function getCustomersFromSheet(force = false) {
  const SHEET_ID = process.env.SHEET_ID || '';
  const TAB_NAME = process.env.SHEET_TAB_NAME || 'Sheet1';
  const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY || '';

  if (PRIVATE_KEY.includes('\\n')) {
    PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');
  }

  if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
    console.warn('Google Sheet: Missing credentials or Sheet ID.');
    return [];
  }

  try {
    // ✅ create JWT client for auth (new method)
    const serviceAccountAuth = new JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);

    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[TAB_NAME] || doc.sheetsByIndex[0];
    if (!sheet) {
      console.warn('Google Sheet tab not found:', TAB_NAME);
      return [];
    }

    const rows = await sheet.getRows();

    return rows.map((row) => {
      const obj = {};
      for (const key of Object.keys(row)) {
        if (key.startsWith('_')) continue;
        obj[key] = row[key];
      }
      return obj;
    });
  } catch (err) {
    console.error('Google Sheet error:', err.message || err);
    return [];
  }
}

export default { getCustomersFromSheet };
