// routes/send.js
import express from 'express';
import pool from '../db.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { client, MessageMedia } from '../whatsapp.js';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

const upload = multer({ dest: 'uploads/' });

// Helper to send message (text or media)
async function sendToNumber(number, message, mediaPath = null) {
  const chatId = `${number}@c.us`;
  if (mediaPath) {
    const media = MessageMedia.fromFilePath(mediaPath);
    if (message && message.trim()) {
      // send text then media
      await client.sendMessage(chatId, message);
    }
    const sent = await client.sendMessage(chatId, media);
    return sent;
  } else {
    const sent = await client.sendMessage(chatId, message);
    return sent;
  }
}

// Send broadcast - accepts either numbers array or broadcast of all customers
router.post('/broadcast', upload.single('media'), async (req, res) => {
  const { numbers, message, broadcastName, sendToAll } = req.body;
  let nums = [];

  if (sendToAll === 'true' || sendToAll === true) {
    // fetch all numbers from DB
    try {
      const r = await pool.query('SELECT phone,id FROM customers');
      nums = r.rows.map(r=>({phone:r.phone, id:r.id}));
    } catch (err) {
      return res.status(500).json({ error: 'DB error fetching customers' });
    }
  } else if (numbers) {
    try {
      const parsed = typeof numbers === 'string' ? JSON.parse(numbers) : numbers;
      nums = parsed.map(n => ({ phone: n, id: null }));
    } catch (err) {
      return res.status(400).json({ error: 'numbers must be JSON array' });
    }
  } else {
    return res.status(400).json({ error: 'no recipients provided' });
  }

  // create broadcast record
  let broadcastId = null;
  try {
    const r = await pool.query(
      `INSERT INTO broadcasts (name, message, status, created_at) VALUES ($1,$2,$3,now()) RETURNING id`,
      [broadcastName||'Broadcast', message||'', 'sending']
    );
    broadcastId = r.rows[0].id;
  } catch (err) {
    console.warn('Cannot create broadcast record', err);
  }

  // handle media file if uploaded
  let mediaPath = null;
  if (req.file) {
    const ext = path.extname(req.file.originalname) || '';
    const newName = path.join('uploads', `${uuidv4()}${ext}`);
    fs.renameSync(req.file.path, newName);
    mediaPath = newName;
  }

  const results = [];
  for (const item of nums) {
    const number = item.phone.replace(/\D/g,''); // clean
    try {
      const sent = await sendToNumber(number, message||'', mediaPath);
      // save message
      await pool.query(
        `INSERT INTO messages (broadcast_id, customer_id, phone, body, whatsapp_message_id, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
        [broadcastId, item.id, number, message||'', sent.id?._serialized || null, 'sent']
      );
      results.push({ number, status: 'sent' });
    } catch (err) {
      console.error('Send error for', number, err);
      try {
        await pool.query(
          `INSERT INTO messages (broadcast_id, customer_id, phone, body, status, error_text, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
          [broadcastId, item.id, number, message||'', 'failed', (err && err.message) || String(err)]
        );
      } catch (e){}
      results.push({ number, status: 'failed', error: err.message || String(err) });
    }
  }

  // cleanup uploaded file (optional)
  if (mediaPath) {
    try { fs.unlinkSync(mediaPath); } catch (e) {}
  }

  res.json({ broadcastId, results });
});

export default router;
