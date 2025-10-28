// send.js
// Robust router for sending WhatsApp messages (text, media, broadcast).
// - Dynamically imports whatsapp helper (if present) to avoid startup crash
// - Uses multer for media uploads
// - Provides /single, /media, /broadcast, /status endpoints

import express from "express";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import multer from "multer";

const router = express.Router();
const cwd = process.cwd();

// ----------------- candidates for whatsapp helper -----------------
const whatsappCandidates = [
  path.join(cwd, "whatsapp.js"),
  path.join(cwd, "src", "whatsapp.js"),
  path.join(cwd, "server", "whatsapp.js"),
];

// ----------------- dynamic loader for local module -----------------
async function tryImportCandidates(candidates = []) {
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const mod = await import(pathToFileURL(p).href);
      return mod;
    } catch (err) {
      console.warn("Import failed for", p, ":", err && err.message ? err.message : err);
    }
  }
  return null;
}

// ----------------- whatsapp client placeholders -----------------
let client = null;
let MessageMedia = null;

// try to load whatsapp helper once (non-blocking)
(async () => {
  try {
    const mod = await tryImportCandidates(whatsappCandidates);
    if (!mod) {
      console.info("WhatsApp helper not found in candidates:", whatsappCandidates);
      return;
    }
    // module may export different shapes
    // prefer default export, otherwise named exports
    const exported = mod.default || mod;
    // if exported is client directly
    if (exported && (typeof exported.initialize === "function" || exported.sendMessage || exported.getNumberId)) {
      client = exported;
    } else if (exported && exported.client) {
      client = exported.client;
    }
    // MessageMedia export
    if (exported && exported.MessageMedia) MessageMedia = exported.MessageMedia;
    if (!MessageMedia) {
      // try to load from whatsapp-web.js if already installed
      try {
        const mod2 = await import("whatsapp-web.js");
        MessageMedia = mod2.MessageMedia || (mod2.default && mod2.default.MessageMedia) || MessageMedia;
      } catch (e) {
        // ignore; will lazy-load later if needed
      }
    }
    console.info("WhatsApp helper loaded:", !!client, "MessageMedia:", !!MessageMedia);
  } catch (err) {
    console.warn("WhatsApp helper import error:", err && err.message ? err.message : err);
  }
})();

// ----------------- multer setup for uploads -----------------
const uploadDir = path.join(cwd, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) =>
    cb(null, Date.now() + "-" + Math.random().toString(36).slice(2) + path.extname(file.originalname)),
});
const upload = multer({ storage });

// ----------------- utilities -----------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const normalizeNumber = (n) => String(n || "").replace(/[+\s\-()]/g, "").trim();

function isClientReadyQuick() {
  try {
    if (!client) return false;
    // different helper implementations may expose readiness differently
    if (client.info && Object.keys(client.info).length > 0) return true;
    if (client.ready) return true;
    return false;
  } catch (e) {
    return false;
  }
}

async function ensureClientReady(timeout = 15000, poll = 500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (isClientReadyQuick()) return true;
    await wait(poll);
  }
  return isClientReadyQuick();
}

async function ensureMessageMedia() {
  if (MessageMedia) return MessageMedia;
  try {
    const mod = await import("whatsapp-web.js");
    MessageMedia = mod.MessageMedia || (mod.default && mod.default.MessageMedia);
    if (MessageMedia) return MessageMedia;
  } catch (err) {
    console.warn("Failed to import whatsapp-web.js for MessageMedia:", err && err.message ? err.message : err);
  }
  throw new Error("MessageMedia not available");
}

async function getNumberIdSafe(number) {
  try {
    if (!client || typeof client.getNumberId !== "function") return null;
    return await client.getNumberId(number);
  } catch (err) {
    console.warn("getNumberId error", err && err.message ? err.message : err);
    return null;
  }
}

// ----------------- endpoints -----------------

// status check
router.get("/status", (req, res) => {
  if (!client) return res.json({ loaded: false, ready: false });
  return res.json({ loaded: true, ready: isClientReadyQuick(), info: client.info || null });
});

// single text send
router.post("/single", async (req, res) => {
  const { number, message, timeoutMs } = req.body || {};
  if (!number || !message) return res.status(400).json({ error: "number and message required" });
  if (!client) return res.status(500).json({ error: "WhatsApp client not loaded" });

  try {
    const ok = await ensureClientReady(timeoutMs || 15000);
    if (!ok) return res.status(503).json({ error: "WhatsApp client not ready" });
  } catch (e) {
    return res.status(503).json({ error: "WhatsApp client readiness error", details: e.message });
  }

  const normalized = normalizeNumber(number);
  const id = await getNumberIdSafe(normalized);
  if (!id) return res.status(400).json({ error: "number_not_registered", number: normalized });

  try {
    const sent = await client.sendMessage(id._serialized || id, message);
    return res.json({ success: true, number: normalized, id: sent?.id?._serialized || null });
  } catch (err) {
    console.error("send single error:", err);
    return res.status(500).json({ error: "send_failed", details: err && err.message ? err.message : String(err) });
  }
});

// media send (multipart/form-data: file)
router.post("/media", upload.single("file"), async (req, res) => {
  const { number, message = "", timeoutMs } = req.body || {};
  if (!number || !req.file) return res.status(400).json({ error: "number and file required" });
  if (!client) return res.status(500).json({ error: "WhatsApp client not loaded" });

  try {
    const ok = await ensureClientReady(timeoutMs || 15000);
    if (!ok) return res.status(503).json({ error: "WhatsApp client not ready" });
  } catch (e) {
    return res.status(503).json({ error: "WhatsApp client readiness error", details: e.message });
  }

  const normalized = normalizeNumber(number);
  const id = await getNumberIdSafe(normalized);
  if (!id) return res.status(400).json({ error: "number_not_registered", number: normalized });

  try {
    const MM = await ensureMessageMedia();
    const media = await MM.fromFilePath(req.file.path);
    const sent = await client.sendMessage(id._serialized || id, media, { caption: message });
    return res.json({ success: true, number: normalized, id: sent?.id?._serialized || null });
  } catch (err) {
    console.error("media send error:", err);
    return res.status(500).json({ error: "media_send_failed", details: err && err.message ? err.message : String(err) });
  }
});

// broadcast: accepts numbers array or CSV string
router.post("/broadcast", async (req, res) => {
  let { numbers, message, concurrency = 5, timeoutMs } = req.body || {};
  if (!message) return res.status(400).json({ error: "message required" });

  if (!numbers) return res.status(400).json({ error: "numbers required" });
  if (typeof numbers === "string") numbers = numbers.split(/[\s,;]+/).filter(Boolean);
  if (!Array.isArray(numbers) || numbers.length === 0) return res.status(400).json({ error: "numbers array required" });

  numbers = numbers.map(normalizeNumber).filter(Boolean);
  concurrency = parseInt(concurrency || process.env.SEND_CONCURRENCY || "5", 10);
  if (isNaN(concurrency) || concurrency < 1) concurrency = 5;

  if (!client) return res.status(500).json({ error: "WhatsApp client not loaded" });
  try {
    const ok = await ensureClientReady(timeoutMs || 15000);
    if (!ok) return res.status(503).json({ error: "WhatsApp client not ready" });
  } catch (e) {
    return res.status(503).json({ error: "WhatsApp client readiness error", details: e.message });
  }

  // simple concurrency runner
  const results = [];
  const pool = [];
  for (const num of numbers) {
    const task = (async () => {
      try {
        const id = await getNumberIdSafe(num);
        if (!id) return { number: num, status: "failed", error: "not_registered" };
        await client.sendMessage(id._serialized || id, message);
        return { number: num, status: "sent" };
      } catch (err) {
        return { number: num, status: "failed", error: err && err.message ? err.message : String(err) };
      }
    })();
    pool.push(task);
    // concurrency control
    if (pool.length >= concurrency) {
      const r = await Promise.race(pool);
      results.push(r);
      // remove resolved promises
      for (let i = pool.length - 1; i >= 0; i--) {
        if (pool[i].status !== undefined) {
          pool.splice(i, 1);
        }
      }
    }
  }
  // wait remaining
  const remaining = await Promise.allSettled(pool);
  for (const p of remaining) {
    if (p.status === "fulfilled") results.push(p.value);
    else results.push({ status: "failed", error: p.reason && p.reason.message ? p.reason.message : String(p.reason) });
  }

  return res.json({ results });
});

export default router;
