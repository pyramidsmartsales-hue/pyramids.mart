// customers.js
import express from "express";
import { readSheetRows, appendSheetRow } from "./google-sheet.js";

const router = express.Router();

/**
 * GET /api/customers
 * Returns customers from Google Sheet
 */
router.get("/", async (req, res) => {
  try {
    const rows = await readSheetRows();
    return res.json({ ok: true, source: "sheet", count: rows.length, data: rows });
  } catch (err) {
    console.error("customers read error:", err && err.message ? err.message : err);
    // Fallback: return empty or try DB if you have one
    return res.status(500).json({ ok: false, error: "read_failed", details: err.message });
  }
});

/**
 * POST /api/customers
 * Body: object with fields matching sheet headers (e.g. name, phone, email)
 * Will append a row to the sheet.
 */
router.post("/", async (req, res) => {
  const body = req.body || {};
  if (!body || Object.keys(body).length === 0) {
    return res.status(400).json({ ok: false, error: "no_data" });
  }

  try {
    const resp = await appendSheetRow(body);
    return res.json({ ok: true, result: resp });
  } catch (err) {
    console.error("customers append error:", err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: "append_failed", details: err.message });
  }
});

export default router;
