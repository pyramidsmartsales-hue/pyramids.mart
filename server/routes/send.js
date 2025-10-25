// send.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { MessageMedia } from "whatsapp-web.js";
import pool from "./db.js";
import client from "./whatsapp.js";

const router = express.Router();

// إنشاء مجلد تخزين مؤقت للملفات
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// إعداد Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// 🔹 إرسال رسالة نصية
router.post("/", async (req, res) => {
  const { number, message, customerId = null, broadcastId = null } = req.body;
  if (!number || !message)
    return res.status(400).json({ error: "number and message are required" });

  try {
    const chatId = `${number}@c.us`;
    const sent = await client.sendMessage(chatId, message);

    await pool.query(
      `INSERT INTO messages (broadcast_id, customer_id, phone, body, whatsapp_message_id, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
      [broadcastId, customerId, number, message, sent.id?._serialized || null, "sent"]
    );

    res.json({ success: true, id: sent.id?._serialized || null });
  } catch (err) {
    console.error("Send error", err);
    await pool.query(
      `INSERT INTO messages (broadcast_id, customer_id, phone, body, status, error_text, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
      [broadcastId, customerId, number, message, "failed", err.message]
    );
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 إرسال صور / ملفات
router.post("/media", upload.single("file"), async (req, res) => {
  const { number, message = "" } = req.body;
  if (!number || !req.file)
    return res.status(400).json({ error: "number and file are required" });

  try {
    const filePath = req.file.path;
    const chatId = `${number}@c.us`;
    const media = MessageMedia.fromFilePath(filePath);
    const sent = await client.sendMessage(chatId, media, { caption: message });

    await pool.query(
      `INSERT INTO messages (phone, body, media_path, whatsapp_message_id, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,now(),now())`,
      [number, message, filePath, sent.id?._serialized || null, "sent"]
    );

    res.json({ success: true, id: sent.id?._serialized || null });
  } catch (err) {
    console.error("Media send error", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 بث جماعي
router.post("/broadcast", async (req, res) => {
  const { numbers, message, broadcastName = "Broadcast" } = req.body;
  if (!Array.isArray(numbers) || numbers.length === 0)
    return res.status(400).json({ error: "numbers array required" });

  let broadcastId = null;
  try {
    const r = await pool.query(
      `INSERT INTO broadcasts (name, message, created_at)
       VALUES ($1,$2,now()) RETURNING id`,
      [broadcastName, message]
    );
    broadcastId = r.rows[0].id;
  } catch (err) {
    console.warn("Could not create broadcast record", err);
  }

  const results = [];

  for (const num of numbers) {
    try {
      const chatId = `${num}@c.us`;
      const sent = await client.sendMessage(chatId, message);

      await pool.query(
        `INSERT INTO messages (broadcast_id, phone, body, whatsapp_message_id, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,now(),now())`,
        [broadcastId, num, message, sent.id?._serialized || null, "sent"]
      );

      results.push({ number: num, status: "sent" });
    } catch (err) {
      results.push({ number: num, status: "failed", error: err.message });
      await pool.query(
        `INSERT INTO messages (broadcast_id, phone, body, status, error_text, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,now(),now())`,
        [broadcastId, num, message, "failed", err.message]
      );
    }
  }

  res.json({ broadcastId, results });
});

export default router;
