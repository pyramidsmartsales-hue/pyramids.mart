// send.js
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";

const router = express.Router();
const cwd = process.cwd();

// candidate helper paths (try to import whatsapp helper)
const whatsappCandidates = [
  path.join(cwd, "whatsapp.js"),
  path.join(cwd, "src", "whatsapp.js"),
  path.join(cwd, "server", "whatsapp.js"),
];

let client = null;
let MessageMedia = null;
let helperModule = null;

// helper: dynamic import attempt
async function tryImportCandidates(candidates = []) {
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const mod = await import(pathToFileURL(p).href);
      return { path: p, mod };
    } catch (err) {
      // continue to next
      console.warn("failed importing candidate", p, err && err.message ? err.message : err);
    }
  }
  return null;
}

import { pathToFileURL } from "url";

(async () => {
  try {
    const found = await tryImportCandidates(whatsappCandidates);
    if (!found) {
      console.info("WhatsApp helper not found in candidates:", whatsappCandidates);
      return;
    }
    const exported = found.mod;
    helperModule = exported;
    // expected exports from helper: client (or getClient()), MessageMedia, ensureClientReady, getNumberIdSafe
    client = exported.client || (exported.getClient ? await exported.getClient() : null);
    MessageMedia = exported.MessageMedia || (exported.getMessageMedia ? await exported.getMessageMedia() : null);
    console.info("WhatsApp helper loaded:", !!client, "MessageMedia:", !!MessageMedia);
  } catch (err) {
    console.warn("WhatsApp helper import error:", err && err.message ? err.message : err);
  }
})();

// setup multer uploads
const uploadDir = path.join(cwd, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

function isClientReadyQuick() {
  try {
    return client && (client.info || client.state) ? true : false;
  } catch (err) {
    return false;
  }
}

// status
router.get("/status", (req, res) => {
  if (!helperModule) return res.json({ loaded: false, ready: false, message: "whatsapp helper not loaded" });
  return res.json({ loaded: true, ready: isClientReadyQuick(), info: client?.info || null });
});

// single message via JSON { number, message }
router.post("/single", async (req, res) => {
  const { number, message, timeoutMs } = req.body || {};
  if (!number || !message) return res.status(400).json({ error: "number and message required" });
  if (!helperModule) return res.status(500).json({ error: "whatsapp_helper_missing" });

  try {
    // ask helper to ensure ready
    if (helperModule.ensureClientReady) {
      const ok = await helperModule.ensureClientReady(timeoutMs || 15000);
      if (!ok) return res.status(503).json({ error: "client_not_ready" });
    }
  } catch (err) {
    return res.status(503).json({ error: "client_ready_error", details: err.message || String(err) });
  }

  const normalize = helperModule.normalizeNumber || ((n) => n);
  const getIdSafe = helperModule.getNumberIdSafe || (async (n) => null);

  const normalized = normalize(number);
  const id = await getIdSafe(normalized);
  if (!id) return res.status(400).json({ error: "number_not_registered", number: normalized });

  try {
    const sent = await client.sendMessage(id._serialized || id, message);
    return res.json({ success: true, number: normalized, id: sent?.id?._serialized || null });
  } catch (err) {
    return res.status(500).json({ error: "send_failed", details: err.message || String(err) });
  }
});

// send with media upload field 'file'
router.post("/single-media", upload.single("file"), async (req, res) => {
  if (!helperModule) return res.status(500).json({ error: "whatsapp_helper_missing" });
  const { number, caption } = req.body || {};
  if (!number || !req.file) return res.status(400).json({ error: "number and file required" });
  try {
    if (helperModule.ensureClientReady) {
      const ok = await helperModule.ensureClientReady(15000);
      if (!ok) return res.status(503).json({ error: "client_not_ready" });
    }
    const normalize = helperModule.normalizeNumber || ((n) => n);
    const getIdSafe = helperModule.getNumberIdSafe || (async (n) => null);
    const normalized = normalize(number);
    const id = await getIdSafe(normalized);
    if (!id) return res.status(400).json({ error: "number_not_registered", number: normalized });

    // create MessageMedia if available
    let MM = MessageMedia;
    if (!MM && helperModule.getMessageMedia) {
      MM = await helperModule.getMessageMedia();
    }
    if (!MM) return res.status(500).json({ error: "MessageMedia_not_available" });

    const data = fs.readFileSync(req.file.path, { encoding: "base64" });
    const mime = req.file.mimetype || undefined;
    const media = new MM(mime, data, req.file.filename);
    await client.sendMessage(id._serialized || id, media, { caption: caption || "" });
    return res.json({ success: true, number });
  } catch (err) {
    console.error("single-media error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ error: "send_media_failed", details: err.message || String(err) });
  }
});

export default router;
