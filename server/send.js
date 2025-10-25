// send.js
import express from "express";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import multer from "multer";

const router = express.Router();

/**
 * Dynamic import helper: tries a list of candidate paths and returns the first module found.
 */
async function findAndImport(moduleNameCandidates) {
  for (const p of moduleNameCandidates) {
    if (fs.existsSync(p)) {
      const m = await import(pathToFileURL(p).href);
      return m.default || m;
    }
  }
  throw new Error("Module not found: " + moduleNameCandidates.join(", "));
}

const cwd = process.cwd();
const dbCandidates = [
  path.join(cwd, "db.js"),
  path.join(cwd, "src", "db.js"),
  path.join(cwd, "server", "db.js"),
  path.join(cwd, "src", "server", "db.js"),
];
const whatsappCandidates = [
  path.join(cwd, "whatsapp.js"),
  path.join(cwd, "src", "whatsapp.js"),
  path.join(cwd, "server", "whatsapp.js"),
  path.join(cwd, "src", "server", "whatsapp.js"),
];

let pool = null;
let client = null;
let MessageMedia = null;

// attempt to import DB module (if present)
(async () => {
  try {
    pool = await findAndImport(dbCandidates);
  } catch (err) {
    console.warn("DB import failed:", err.message);
  }
})();

// attempt to import whatsapp helper module (should export default client and optionally MessageMedia/getLastQr)
(async () => {
  try {
    const w = await findAndImport(whatsappCandidates);
    client = w.default || w;
    MessageMedia = w.MessageMedia || (w.default && w.default.MessageMedia) || null;
  } catch (err) {
    console.warn("WhatsApp import failed:", err.message);
  }
})();

// multer setup for uploads (ensure folder exists)
const uploadDir = path.join(cwd, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + Math.random().toString(36).slice(2) + path.extname(file.originalname)),
});
const upload = multer({ storage });

// helper: check client ready (non-blocking)
function isClientReady() {
  try {
    return client && client.info && Object.keys(client.info).length > 0;
  } catch {
    return false;
  }
}

/**
 * Wait for client readiness by polling client.info until timeout.
 * @param {number} timeoutMs milliseconds to wait (default 20000)
 * @param {number} intervalMs polling interval (default 500)
 * @returns {Promise<boolean>} true if ready before timeout, false otherwise
 */
async function ensureClientReady(timeoutMs = 20000, intervalMs = 500) {
  const start = Date.now();
  if (isClientReady()) return true;

  while (Date.now() - start < timeoutMs) {
    if (client && isClientReady()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return isClientReady();
}

// normalize phone number to digits only
function normalizeNumber(n) {
  return String(n || "").replace(/[+\s\-()]/g, "").trim();
}

// -------------------- single text send --------------------
router.post("/", async (req, res) => {
  const { number, message, customerId = null, broadcastId = null } = req.body;
  if (!number || !message) return res.status(400).json({ error: "number and message are required" });

  if (!client) {
    return res.status(500).json({ error: "WhatsApp client module not loaded" });
  }

  // Wait for client readiness (up to 20s)
  const ready = await ensureClientReady(20000);
  if (!ready) {
    return res.status(503).json({ error: "WhatsApp client not ready after waiting 20s. Check server logs." });
  }

  try {
    const normalized = normalizeNumber(number);
    const numberId = await client.getNumberId(normalized);
    if (!numberId) {
      const errObj = { error: "number_not_registered", number: normalized };
      // save to DB if available
      if (pool) {
        try {
          await pool.query(
            `INSERT INTO messages (broadcast_id, customer_id, phone, body, status, error_text, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
            [broadcastId, customerId, normalized, message, "failed", "number_not_registered"]
          );
        } catch (e) {
          console.warn("Could not save message (not registered):", e.message);
        }
      }
      return res.status(400).json(errObj);
    }

    const chatId = numberId._serialized || `${normalized}@c.us`;
    const sent = await client.sendMessage(chatId, message);

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO messages (broadcast_id, customer_id, phone, body, whatsapp_message_id, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
          [broadcastId, customerId, normalized, message, sent.id?._serialized || null, "sent"]
        );
      } catch (e) {
        console.warn("Could not save message:", e.message);
      }
    }

    return res.json({ success: true, id: sent.id?._serialized || null });
  } catch (err) {
    console.error("Send error", err);
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO messages (broadcast_id, customer_id, phone, body, status, error_text, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
          [broadcastId, customerId, normalizeNumber(number), message, "failed", err.message]
        );
      } catch (_) {}
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------- media send --------------------
router.post("/media", upload.single("file"), async (req, res) => {
  const { number, message = "" } = req.body;
  if (!number || !req.file) return res.status(400).json({ error: "number and file are required" });

  if (!client) {
    return res.status(500).json({ error: "WhatsApp client module not loaded" });
  }

  const ready = await ensureClientReady(20000);
  if (!ready) {
    return res.status(503).json({ error: "WhatsApp client not ready after waiting 20s. Check server logs." });
  }

  try {
    const normalized = normalizeNumber(number);
    const numberId = await client.getNumberId(normalized);
    if (!numberId) {
      const errObj = { error: "number_not_registered", number: normalized };
      if (pool) {
        try {
          await pool.query(
            `INSERT INTO messages (phone, body, media_path, status, error_text, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,now(),now())`,
            [normalized, message, req.file.path, "failed", "number_not_registered"]
          );
        } catch (e) {
          console.warn("Could not save media message (not registered):", e.message);
        }
      }
      return res.status(400).json(errObj);
    }

    // ensure MessageMedia available
    if (!MessageMedia) {
      try {
        const wpkg = await import("whatsapp-web.js");
        MessageMedia = wpkg.MessageMedia;
      } catch (e) {
        console.warn("Could not import MessageMedia:", e.message);
      }
    }
    if (!MessageMedia) throw new Error("MessageMedia not available");

    const filePath = req.file.path;
    const media = MessageMedia.fromFilePath(filePath);
    const chatId = numberId._serialized || `${normalized}@c.us`;
    const sent = await client.sendMessage(chatId, media, { caption: message });

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO messages (phone, body, media_path, whatsapp_message_id, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,now(),now())`,
          [normalized, message, filePath, sent.id?._serialized || null, "sent"]
        );
      } catch (e) {
        console.warn("Could not save media message:", e.message);
      }
    }

    return res.json({ success: true, id: sent.id?._serialized || null });
  } catch (err) {
    console.error("Media send error", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------- broadcast --------------------
router.post("/broadcast", async (req, res) => {
  let { numbers, number, message, broadcastName = "Broadcast" } = req.body;
  if (!numbers && number) numbers = [number];
  if (typeof numbers === "string") numbers = numbers.split(/[\s,;]+/).filter(Boolean);
  if (!Array.isArray(numbers)) return res.status(400).json({ error: "numbers array required" });

  numbers = numbers.map((n) => normalizeNumber(n)).filter(Boolean);
  if (numbers.length === 0) return res.status(400).json({ error: "numbers array required" });

  if (!client) return res.status(500).json({ error: "WhatsApp client module not loaded" });

  const ready = await ensureClientReady(20000);
  if (!ready) {
    return res.status(503).json({ error: "WhatsApp client not ready after waiting 20s. Check server logs." });
  }

  // create broadcast record if DB available
  let broadcastId = null;
  if (pool) {
    try {
      const r = await pool.query(`INSERT INTO broadcasts (name, message, created_at) VALUES ($1,$2,now()) RETURNING id`, [
        broadcastName,
        message,
      ]);
      broadcastId = r.rows[0].id;
    } catch (err) {
      console.warn("Could not create broadcast record", err.message);
    }
  }

  const results = [];
  for (const rawNum of numbers) {
    const normalized = normalizeNumber(rawNum);
    try {
      const numberId = await client.getNumberId(normalized);
      if (!numberId) {
        const errText = "number_not_registered_on_whatsapp";
        results.push({ number: normalized, status: "failed", error: errText });
        if (pool) {
          try {
            await pool.query(
              `INSERT INTO messages (broadcast_id, phone, body, status, error_text, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,now(),now())`,
              [broadcastId, normalized, message, "failed", errText]
            );
          } catch (_) {}
        }
        continue;
      }

      const chatId = numberId._serialized || `${normalized}@c.us`;
      const sent = await client.sendMessage(chatId, message);

      if (pool) {
        try {
          await pool.query(
            `INSERT INTO messages (broadcast_id, phone, body, whatsapp_message_id, status, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,now(),now())`,
            [broadcastId, normalized, message, sent.id?._serialized || null, "sent"]
          );
        } catch (e) {
          console.warn("Could not save broadcast message:", e.message);
        }
      }

      results.push({ number: normalized, status: "sent" });
    } catch (err) {
      console.error("Broadcast send error for", normalized, err);
      results.push({ number: normalized, status: "failed", error: err.message });
      if (pool) {
        try {
          await pool.query(
            `INSERT INTO messages (broadcast_id, phone, body, status, error_text, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,now(),now())`,
            [broadcastId, normalized, message, "failed", err.message]
          );
        } catch (_) {}
      }
    }
  }

  return res.json({ broadcastId, results });
});

export default router;
