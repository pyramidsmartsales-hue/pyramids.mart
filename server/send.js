// send.js
// Improved send router
// - robust dynamic import of whatsapp helper
// - ensureClientReady waits for 'ready' event (with timeout)
// - send single, send media, broadcast with concurrency control
// - returns detailed per-number results

import express from "express";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import multer from "multer";

const router = express.Router();
const cwd = process.cwd();

// -------------------- helpers to dynamically import modules --------------------
async function tryImport(paths = []) {
  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      const mod = await import(pathToFileURL(p).href);
      return mod;
    } catch (err) {
      // try next
      console.warn("Import failed for", p, ":", err.message || err);
    }
  }
  return null;
}

// candidate locations
const whatsappCandidates = [
  path.join(cwd, "whatsapp.js"),
  path.join(cwd, "src", "whatsapp.js"),
  path.join(cwd, "server", "whatsapp.js"),
];

let client = null;
let MessageMedia = null;

// load whatsapp helper (attempt immediately)
(async () => {
  const mod = await tryImport(whatsappCandidates);
  if (!mod) {
    console.warn("WhatsApp helper not found in candidates:", whatsappCandidates);
    return;
  }
  // module may export in different ways
  try {
    // default export might be client or object
    if (mod.default) {
      // if default looks like a client (has initialize/on/sendMessage) use it
      if (typeof mod.default === "object" || typeof mod.default === "function") {
        if (mod.default.initialize || mod.default.on || mod.default.sendMessage) {
          client = mod.default;
        }
      }
      // default might be an object containing client and MessageMedia and helper
      if (!client && mod.default.client) client = mod.default.client;
      if (!MessageMedia && mod.default.MessageMedia) MessageMedia = mod.default.MessageMedia;
    }
    // named exports
    if (!client && mod.client) client = mod.client;
    if (!MessageMedia && mod.MessageMedia) MessageMedia = mod.MessageMedia;
    console.info("WhatsApp helper loaded:", !!client, "MessageMedia:", !!MessageMedia);
  } catch (err) {
    console.warn("Error analyzing whatsapp module exports:", err.message || err);
  }
})();

// -------------------- multer setup for media uploads --------------------
const uploadDir = path.join(cwd, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) =>
    cb(null, Date.now() + "-" + Math.random().toString(36).slice(2) + path.extname(file.originalname)),
});
const upload = multer({ storage });

// -------------------- utilities --------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (n) => String(n || "").replace(/[^\d]/g, "").trim();

// improved ensureClientReady: listens to ready event, and also checks client.info
function isClientReadyLocal() {
  try {
    return !!(client && ((client.info && client.info.me) || client.ready));
  } catch (e) {
    return false;
  }
}

function ensureClientReady(timeout = 60000) {
  return new Promise((resolve, reject) => {
    if (!client) return reject(new Error("no_client"));

    // already ready?
    if (isClientReadyLocal()) return resolve(true);

    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      return reject(new Error("timeout_waiting_ready"));
    }, timeout);

    function cleanup() {
      try {
        client.removeListener && client.removeListener("ready", onReady);
        client.removeListener && client.removeListener("auth_failure", onAuthFailure);
      } catch (e) {}
      clearTimeout(timer);
    }

    function onReady() {
      if (finished) return;
      finished = true;
      cleanup();
      return resolve(true);
    }
    function onAuthFailure(msg) {
      console.warn("auth_failure while waiting for ready:", msg);
      // do not reject immediately, allow continue waiting
    }

    // attach listeners
    try {
      client.on && client.on("ready", onReady);
      client.on && client.on("auth_failure", onAuthFailure);
    } catch (e) {
      clearTimeout(timer);
      return reject(e);
    }
  });
}

// concurrency pool: runs async tasks with concurrency limit
async function asyncPool(poolLimit, array, iteratorFn) {
  const ret = [];
  const executing = new Set();
  for (const item of array) {
    const p = (async () => iteratorFn(item))();
    ret.push(p);
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= poolLimit) {
      // wait for the earliest to finish
      await Promise.race(executing);
    }
  }
  return Promise.all(ret);
}

// helper to get MessageMedia dynamically if not loaded
async function ensureMessageMedia() {
  if (MessageMedia) return MessageMedia;
  try {
    const mod = await import("whatsapp-web.js");
    MessageMedia = mod.MessageMedia || (mod.default && mod.default.MessageMedia);
    return MessageMedia;
  } catch (err) {
    console.warn("Failed to import MessageMedia:", err.message || err);
    throw err;
  }
}

// helper to get number id
async function getNumberIdSafe(number) {
  try {
    const id = await client.getNumberId(number);
    return id;
  } catch (err) {
    // some versions might throw; return null
    console.warn("getNumberId error for", number, err.message || err);
    return null;
  }
}

// -------------------- endpoints --------------------

// single text send
router.post("/single", async (req, res) => {
  const { number, message, timeoutMs } = req.body || {};
  if (!number || !message) return res.status(400).json({ error: "number and message required" });
  if (!client) return res.status(500).json({ error: "WhatsApp client not loaded" });

  try {
    await ensureClientReady(timeoutMs || 60000);
  } catch (e) {
    return res.status(503).json({ error: "WhatsApp client not ready", details: e.message });
  }

  const normalized = normalize(number);
  const id = await getNumberIdSafe(normalized);
  if (!id) return res.status(400).json({ error: "number_not_registered", number: normalized });

  try {
    const sent = await client.sendMessage(id._serialized, message);
    return res.json({ success: true, number: normalized, id: sent.id?._serialized || null });
  } catch (err) {
    console.error("send single error:", err);
    return res.status(500).json({ error: "send_failed", details: err.message || String(err) });
  }
});

// media send (form-data: file, fields: number, message)
router.post("/media", upload.single("file"), async (req, res) => {
  const { number, message = "", timeoutMs } = req.body || {};
  if (!number || !req.file) return res.status(400).json({ error: "number and file required" });
  if (!client) return res.status(500).json({ error: "WhatsApp client not loaded" });

  try {
    await ensureClientReady(timeoutMs || 60000);
  } catch (e) {
    return res.status(503).json({ error: "WhatsApp client not ready", details: e.message });
  }

  const normalized = normalize(number);
  const id = await getNumberIdSafe(normalized);
  if (!id) return res.status(400).json({ error: "number_not_registered", number: normalized });

  try {
    const MM = await ensureMessageMedia();
    const media = await MM.fromFilePath(req.file.path);
    const sent = await client.sendMessage(id._serialized, media, { caption: message });
    return res.json({ success: true, number: normalized, id: sent.id?._serialized || null });
  } catch (err) {
    console.error("media send error:", err);
    return res.status(500).json({ error: "media_send_failed", details: err.message || String(err) });
  }
});

// broadcast: numbers can be array or comma-separated string
// body: { numbers, message, concurrency (optional), timeoutMs (optional) }
router.post("/broadcast", async (req, res) => {
  let { numbers, message, concurrency, timeoutMs } = req.body || {};
  if (!message) return res.status(400).json({ error: "message required" });

  if (!numbers) return res.status(400).json({ error: "numbers required" });
  if (typeof numbers === "string") {
    numbers = numbers.split(/[\s,;]+/).filter(Boolean);
  }
  if (!Array.isArray(numbers) || numbers.length === 0) return res.status(400).json({ error: "numbers array required" });

  numbers = numbers.map(normalize).filter(Boolean);
  concurrency = parseInt(concurrency || process.env.SEND_CONCURRENCY || "5", 10);
  if (isNaN(concurrency) || concurrency < 1) concurrency = 5;

  if (!client) return res.status(500).json({ error: "WhatsApp client not loaded" });

  try {
    await ensureClientReady(timeoutMs || 60000);
  } catch (e) {
    return res.status(503).json({ error: "WhatsApp client not ready", details: e.message });
  }

  // iterator function to send to a single number
  const sendOne = async (num) => {
    try {
      const id = await getNumberIdSafe(num);
      if (!id) return { number: num, status: "failed", error: "not_registered" };

      await client.sendMessage(id._serialized, message);
      return { number: num, status: "sent" };
    } catch (err) {
      console.error("broadcast send error for", num, err.message || err);
      return { number: num, status: "failed", error: err.message || String(err) };
    }
  };

  try {
    const results = await asyncPool(concurrency, numbers, sendOne);
    return res.json({ results });
  } catch (err) {
    console.error("broadcast error:", err);
    return res.status(500).json({ error: "broadcast_failed", details: err.message || String(err) });
  }
});

// small helper endpoint to check whether client loaded/ready
router.get("/status", (req, res) => {
  if (!client) return res.json({ loaded: false, ready: false });
  const ready = isClientReadyLocal();
  return res.json({ loaded: true, ready, info: client.info || null });
});

export default router;
