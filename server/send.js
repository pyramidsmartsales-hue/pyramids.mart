// server/send.js
import express from "express";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import multer from "multer";

const router = express.Router();
const cwd = process.cwd();

// candidate helper paths
const whatsappCandidates = [
  path.join(cwd, "whatsapp.js"),
  path.join(cwd, "src", "whatsapp.js"),
  path.join(cwd, "server", "whatsapp.js"),
];

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

let client = null;
let MessageMedia = null;

(async () => {
  try {
    const mod = await tryImportCandidates(whatsappCandidates);
    if (!mod) {
      console.info("WhatsApp helper not found in candidates:", whatsappCandidates);
      return;
    }
    const exported = mod.default || mod;
    if (exported && (typeof exported.initialize === "function" || exported.sendMessage || exported.getNumberId)) {
      client = exported;
    } else if (exported && exported.client) {
      client = exported.client;
    }
    if (exported && exported.MessageMedia) MessageMedia = exported.MessageMedia;
    if (!MessageMedia) {
      try {
        const mod2 = await import("whatsapp-web.js");
        MessageMedia = mod2.MessageMedia || (mod2.default && mod2.default.MessageMedia) || MessageMedia;
      } catch (e) {
        // ignore
      }
    }
    console.info("WhatsApp helper loaded:", !!client, "MessageMedia:", !!MessageMedia);
  } catch (err) {
    console.warn("WhatsApp helper import error:", err && err.message ? err.message : err);
  }
})();

const uploadDir = path.join(cwd, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) =>
    cb(null, Date.now() + "-" + Math.random().toString(36).slice(2) + path.extname(file.originalname)),
});
const upload = multer({ storage });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const normalizeNumber = (n) => String(n || "").replace(/[+\s\-()]/g, "").trim();

function isClientReadyQuick() {
  try {
    if (!client) return false;
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

router.get("/status", (req, res) => {
  if (!client) return res.json({ loaded: false, ready: false });
  return res.json({ loaded: true, ready: isClientReadyQuick(), info: client.info || null });
});

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

  const results = [];
  for (const num of numbers) {
    try {
      const id = await getNumberIdSafe(num);
      if (!id) results.push({ number: num, status: "failed", error: "not_registered" });
      else {
        await client.sendMessage(id._serialized || id, message);
        results.push({ number: num, status: "sent" });
      }
    } catch (err) {
      results.push({ number: num, status: "failed", error: err && err.message ? err.message : String(err) });
    }
  }

  return res.json({ results });
});

export default router;
