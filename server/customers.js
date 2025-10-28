// server/customers.js
import express from "express";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const router = express.Router();

// dynamic load google-sheet helper to avoid startup crash
async function tryLoadGoogleSheet() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "google-sheet.js"),
    path.join(cwd, "server", "google-sheet.js"),
    path.join(cwd, "src", "server", "google-sheet.js"),
    path.join(cwd, "src", "google-sheet.js"),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const mod = await import(pathToFileURL(p).href);
      const fn = mod.getCustomersFromSheet || (mod.default && mod.default.getCustomersFromSheet);
      if (typeof fn === "function") return fn;
    } catch (e) {
      console.warn("customers.js: google-sheet import error", e && e.message ? e.message : e);
    }
  }
  return null;
}

// try to load db pool
async function tryLoadDb() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "db.js"),
    path.join(cwd, "server", "db.js"),
    path.join(cwd, "src", "db.js"),
    path.join(cwd, "src", "server", "db.js"),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const mod = await import(pathToFileURL(p).href);
      const pool = mod.default || mod;
      if (pool && typeof pool.query === "function") return pool;
    } catch (e) {
      console.warn("customers.js: db import error", e && e.message ? e.message : e);
    }
  }
  return null;
}

const sheetFn = await tryLoadGoogleSheet();
const dbPool = await tryLoadDb();

router.get("/", async (req, res) => {
  const force = req.query.force === "1" || req.query.force === "true";

  if (sheetFn) {
    try {
      const rows = await sheetFn(force);
      if (Array.isArray(rows) && rows.length > 0) {
        return res.json({ ok: true, source: "sheet", count: rows.length, data: rows });
      }
    } catch (err) {
      console.warn("customers.js: sheet read error", err && err.message ? err.message : err);
    }
  }

  if (!dbPool) return res.status(500).json({ ok: false, error: "No data source available" });

  try {
    const { rows } = await dbPool.query("SELECT * FROM customers ORDER BY created_at DESC");
    return res.json({ ok: true, source: "db", count: rows.length, data: rows });
  } catch (err) {
    console.error("customers.js: db error", err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: "DB error" });
  }
});

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
    console.error("customers.js: insert error", err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: "DB error" });
  }
});

export default router;
