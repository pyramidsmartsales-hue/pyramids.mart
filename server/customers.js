// customers.js
import express from "express";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const router = express.Router();

async function findAndImportDb() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "db.js"),
    path.join(cwd, "src", "db.js"),
    path.join(cwd, "server", "db.js"),
    path.join(cwd, "src", "server", "db.js"),
    path.join(cwd, "..", "db.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const m = await import(pathToFileURL(p).href);
      return m.default || m;
    }
  }
  throw new Error("db.js not found in expected locations: " + candidates.join(", "));
}

const pool = await (async () => {
  try {
    return await findAndImportDb();
  } catch (err) {
    console.error(err);
    return null;
  }
})();

// Create customer
router.post("/", async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not available" });
  const { name, phone, email, metadata } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO customers (name, phone, email, metadata) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name || null, phone, email || null, metadata ? JSON.stringify(metadata) : null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("DB insert error", err);
    res.status(500).json({ error: "DB error" });
  }
});

// Get customers
router.get("/", async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not available" });
  try {
    const { rows } = await pool.query("SELECT * FROM customers ORDER BY created_at DESC");
    res.json(rows);
  } catch (err) {
    console.error("DB select error", err);
    res.status(500).json({ error: "DB error" });
  }
});

export default router;
