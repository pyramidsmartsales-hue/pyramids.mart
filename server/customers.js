// customers.js
// Router for /api/customers
// Tries Google Sheet first (if google-sheet.js exists and is configured), otherwise falls back to DB.

import express from "express";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const router = express.Router();

/**
 * Try to load google-sheet helper from common locations.
 * Expect exported function: getCustomersFromSheet(force = false)
 */
async function tryLoadGoogleSheetHelper() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "google-sheet.js"),
    path.join(cwd, "src", "google-sheet.js"),
    path.join(cwd, "server", "google-sheet.js"),
  ];

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const mod = await import(pathToFileURL(p).href);
      // support both named and default export
      if (mod.getCustomersFromSheet && typeof mod.getCustomersFromSheet === "function") {
        return { getCustomersFromSheet: mod.getCustomersFromSheet };
      }
      if (mod.default && mod.default.getCustomersFromSheet && typeof mod.default.getCustomersFromSheet === "function") {
        return { getCustomersFromSheet: mod.default.getCustomersFromSheet };
      }
    } catch (err) {
      console.warn("customers.js: could not import google-sheet helper at", p, err.message || err);
    }
  }
  return null;
}

/**
 * Try to load DB pool from common locations.
 * Accepts modules that export `query` function or a default export (e.g. pg Pool).
 */
async function tryLoadDbPool() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "db.js"),
    path.join(cwd, "src", "db.js"),
    path.join(cwd, "server", "db.js"),
    path.join(cwd, "src", "server", "db.js"),
    path.join(cwd, "..", "db.js"),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const mod = await import(pathToFileURL(p).href);
      const pool = mod.default || mod;
      // quick sanity: should have query function
      if (pool && (typeof pool.query === "function" || typeof pool.query === "object")) {
        return pool;
      }
    } catch (err) {
      console.warn("customers.js: could not import db candidate at", p, err.message || err);
    }
  }
  return null;
}

// Load helpers at startup
const sheetHelper = await (async () => {
  try {
    return await tryLoadGoogleSheetHelper();
  } catch (e) {
    console.error("customers.js: google sheet helper load error", e.message || e);
    return null;
  }
})();

const dbPool = await (async () => {
  try {
    return await tryLoadDbPool();
  } catch (e) {
    console.error("customers.js: db load error", e.message || e);
    return null;
  }
})();

/**
 * POST /api/customers
 * Inserts into DB. (Google Sheet treated as read-only here)
 */
router.post("/", async (req, res) => {
  if (!dbPool) return res.status(500).json({ ok: false, error: "DB not configured" });

  const { name, phone, email, metadata } = req.body || {};
  try {
    const result = await dbPool.query(
      `INSERT INTO customers (name, phone, email, metadata) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name || null, phone || null, email || null, metadata ? JSON.stringify(metadata) : null]
    );
    return res.json({ ok: true, source: "db", data: result.rows[0] });
  } catch (err) {
    console.error("customers.js: DB insert error", err);
    return res.status(500).json({ ok: false, error: "DB error" });
  }
});

/**
 * GET /api/customers
 * Priority:
 *   1) If google sheet helper present: attempt to read sheet (use ?force=1 to bypass cache)
 *   2) If sheet yields rows -> return them (source: sheet)
 *   3) Otherwise fallback to DB (source: db)
 */
router.get("/", async (req, res) => {
  const force = req.query.force === "1" || req.query.force === "true";

  // 1) Try Google Sheet
  if (sheetHelper && typeof sheetHelper.getCustomersFromSheet === "function") {
    try {
      const rows = await sheetHelper.getCustomersFromSheet(force);
      if (Array.isArray(rows) && rows.length > 0) {
        return res.json({ ok: true, source: "sheet", count: rows.length, data: rows });
      }
      // if no rows returned, we will fall back to DB (if available)
    } catch (err) {
      console.warn("customers.js: error reading from Google Sheet, falling back to DB:", err.message || err);
      // continue to DB fallback
    }
  }

  // 2) Fallback to DB
  if (!dbPool) {
    // neither sheet data nor DB available
    return res.status(500).json({ ok: false, error: "No data source available (no sheet data and DB not configured)" });
  }

  try {
    const { rows } = await dbPool.query("SELECT * FROM customers ORDER BY created_at DESC");
    return res.json({ ok: true, source: "db", count: rows.length, data: rows });
  } catch (err) {
    console.error("customers.js: DB select error", err);
    return res.status(500).json({ ok: false, error: "DB error" });
  }
});

export default router;
