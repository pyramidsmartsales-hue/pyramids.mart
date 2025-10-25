// send.js
import express from "express";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import multer from "multer";

const router = express.Router();

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

// multer setup
const uploadDir = path.join(cwd, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + Math.random().toString(36).slice(2) + path.extname(file.originalname)),
});
const upload = multer({ storage });

// text message
router.post("/", async (req, res) => {
  const { number, message, customerId = null, broadcastId = null } = req.body;
  if (!number || !message) return res.status(400).json({ error: "number and message are required" });
  if (!client) return res.status(500).json({ error: "WhatsApp client not available" });

  try {
    const chatId = `${String(number).replace(/[+\s\-()]/g, "")}@c.us`;
    const sent = await client.sendMessage(chatId, message);

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO messages (broadcast_id, customer_id, phone, body, whatsapp_message_id, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
          [broadcastId, customerId, String(number).replace(/[+\s\-()]/g, ""), message, sent.id?._serialized || null, "sent"]
        );
      } catch (e) {
        console.warn("Could not save message:", e.message);
      }
    }

    res.json({ success: true, id: sent.id?._serialized || null });
  } catch (err) {
    console.error("Send error", err);
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO messages (broadcast_id, customer_id, phone, body, status, error_text, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
          [broadcastId, customerId, String(number).replace(/[+\s\-()]/g, ""), message, "failed", err.message]
        );
      } catch (_) {}
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// media upload/send
router.post("/media", upload.single("file"), async (req, res) => {
  const { number, message = "" } = req.body;
  if (!number || !req.file) return res.status(400).json({ error: "number and file are required" });
  if (!client) return res.status(500).json({ error: "WhatsApp client not available" });

  try {
    const filePath = req.file.path;
    if (!MessageMedia) {
      try {
        const wpkg = await import("whatsapp-web.js");
        MessageMedia = wpkg.MessageMedia;
      } catch {}
    }
    if (!MessageMedia) throw new Error("MessageMedia not available");

    const media = MessageMedia.fromFilePath(filePath);
    const chatId = `${String(number).replace(/[+\s\-()]/g, "")}@c.us`;
    const sent = await client.sendMessage(chatId, media, { caption: message });

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO messages (phone, body, media_path, whatsapp_message_id, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,now(),now())`,
          [String(number).replace(/[+\s\-()]/g, ""), message, filePath, sent.id?._serialized || null, "sent"]
        );
      } catch (e) {
        console.warn("Could not save media message:", e.message);
      }
    }

    res.json({ success: true, id: sent.id?._serialized || null });
  } catch (err) {
    console.error("Media send error", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// broadcast (مرن: يقبل array أو csv string أو number)
router.post("/broadcast", async (req, res) => {
  // Inputs accepted: { numbers: [...] } or { numbers: "2547...,25411..." } or { number: "2547..." }
  let { numbers, number, message, broadcastName = "Broadcast" } = req.body;

  if (!numbers && number) numbers = [number];

  if (typeof numbers === "string") {
    numbers = numbers.split(/[\s,;]+/).filter(Boolean);
  }

  if (!Array.isArray(numbers)) {
    return res.status(400).json({ error: "numbers array required" });
  }

  // clean numbers
  numbers = numbers.map((n) => String(n).replace(/[+\s\-()]/g, "").trim()).filter(Boolean);

  if (numbers.length === 0) return res.status(400).json({ error: "numbers array required" });

  if (!client) return res.status(500).json({ error: "WhatsApp client not available" });

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
    try {
      const chatId = `${String(rawNum)}@c.us`;
      const sent = await client.sendMessage(chatId, message);

      if (pool) {
        try {
          await pool.query(
            `INSERT INTO messages (broadcast_id, phone, body, whatsapp_message_id, status, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,now(),now())`,
            [broadcastId, String(rawNum), message, sent.id?._serialized || null, "sent"]
          );
        } catch (e) {
          console.warn("Could not save broadcast message:", e.message);
        }
      }

      results.push({ number: String(rawNum), status: "sent" });
    } catch (err) {
      results.push({ number: String(rawNum), status: "failed", error: err.message });
      if (pool) {
        try {
          await pool.query(
            `INSERT INTO messages (broadcast_id, phone, body, status, error_text, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,now(),now())`,
            [broadcastId, String(rawNum), message, "failed", err.message]
          );
        } catch (_) {}
      }
    }
  }

  res.json({ broadcastId, results });
});

export default router;
