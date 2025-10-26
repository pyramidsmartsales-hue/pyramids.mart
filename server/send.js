// send.js
import express from "express";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import multer from "multer";

const router = express.Router();

// ---------- import helpers ----------
async function findAndImport(candidates) {
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const m = await import(pathToFileURL(p).href);
      return m.default || m;
    }
  }
  throw new Error("Module not found: " + candidates.join(", "));
}

const cwd = process.cwd();
const dbCandidates = [
  path.join(cwd, "db.js"),
  path.join(cwd, "src", "db.js"),
  path.join(cwd, "server", "db.js"),
];
const whatsappCandidates = [
  path.join(cwd, "whatsapp.js"),
  path.join(cwd, "src", "whatsapp.js"),
  path.join(cwd, "server", "whatsapp.js"),
];

let pool = null;
let client = null;
let MessageMedia = null;

// ---------- load modules ----------
(async () => {
  try {
    pool = await findAndImport(dbCandidates);
  } catch (err) {
    console.warn("DB import failed:", err.message);
  }
  try {
    const w = await findAndImport(whatsappCandidates);
    client = w.default || w;
    MessageMedia = w.MessageMedia || (w.default && w.default.MessageMedia) || null;
  } catch (err) {
    console.warn("WhatsApp import failed:", err.message);
  }
})();

// ---------- multer setup ----------
const uploadDir = path.join(cwd, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) =>
    cb(null, Date.now() + "-" + Math.random().toString(36).slice(2) + path.extname(file.originalname)),
});
const upload = multer({ storage });

// ---------- helper functions ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (n) => String(n || "").replace(/[+\s\-()]/g, "").trim();
const isClientReady = () => client && client.info && Object.keys(client.info).length > 0;

async function ensureClientReady(timeout = 15000, step = 500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (isClientReady()) return true;
    await wait(step);
  }
  return isClientReady();
}

// ---------- single text send ----------
router.post("/", async (req, res) => {
  const { number, message } = req.body;
  if (!number || !message)
    return res.status(400).json({ error: "number and message are required" });
  if (!client) return res.status(500).json({ error: "WhatsApp client not loaded" });

  if (!(await ensureClientReady()))
    return res.status(503).json({ error: "WhatsApp client not ready. Try again." });

  try {
    const normalized = normalize(number);
    const numberId = await client.getNumberId(normalized);
    if (!numberId)
      return res.status(400).json({ error: "number_not_registered", number: normalized });

    const sent = await client.sendMessage(numberId._serialized, message);
    res.json({ success: true, id: sent.id?._serialized || null });
  } catch (err) {
    console.error("Send error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- media send ----------
router.post("/media", upload.single("file"), async (req, res) => {
  const { number, message = "" } = req.body;
  if (!number || !req.file)
    return res.status(400).json({ error: "number and file are required" });
  if (!client) return res.status(500).json({ error: "WhatsApp client not loaded" });

  if (!(await ensureClientReady()))
    return res.status(503).json({ error: "WhatsApp client not ready. Try again." });

  try {
    const normalized = normalize(number);
    const numberId = await client.getNumberId(normalized);
    if (!numberId)
      return res.status(400).json({ error: "number_not_registered", number: normalized });

    if (!MessageMedia) {
      const w = await import("whatsapp-web.js");
      MessageMedia = w.MessageMedia;
    }
    const media = MessageMedia.fromFilePath(req.file.path);
    const sent = await client.sendMessage(numberId._serialized, media, { caption: message });
    res.json({ success: true, id: sent.id?._serialized || null });
  } catch (err) {
    console.error("Media send error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- broadcast ----------
router.post("/broadcast", async (req, res) => {
  let { numbers, number, message } = req.body;
  if (!numbers && number) numbers = [number];
  if (typeof numbers === "string") numbers = numbers.split(/[\s,;]+/).filter(Boolean);
  if (!Array.isArray(numbers))
    return res.status(400).json({ error: "numbers array required" });
  numbers = numbers.map(normalize).filter(Boolean);

  if (!client) return res.status(500).json({ error: "WhatsApp client not loaded" });
  if (!(await ensureClientReady()))
    return res.status(503).json({ error: "WhatsApp client not ready. Try again." });

  const results = [];
  for (const n of numbers) {
    try {
      const id = await client.getNumberId(n);
      if (!id) {
        results.push({ number: n, status: "failed", error: "not_registered" });
        continue;
      }
      await client.sendMessage(id._serialized, message);
      results.push({ number: n, status: "sent" });
    } catch (err) {
      results.push({ number: n, status: "failed", error: err.message });
    }
  }
  res.json({ results });
});

export default router;
