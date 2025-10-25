// server/routes/send.js
import express from 'express';
import client from '../whatsapp.js';
import pool from '../db.js';

const router = express.Router();

// Send single message
router.post('/', async (req, res) => {
  const { number, message, customerId = null, broadcastId = null } = req.body;
  if (!number || !message) return res.status(400).json({ error: 'number and message are required' });

  try {
    const chatId = `${number}@c.us`;
    const sent = await client.sendMessage(chatId, message);

    // store in DB
    try {
      await pool.query(
        `INSERT INTO messages (broadcast_id, customer_id, phone, body, whatsapp_message_id, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
        [broadcastId, customerId, number, message, sent.id?._serialized || null, 'sent']
      );
    } catch (dbErr) {
      console.warn('Could not store message in DB', dbErr);
    }

    res.json({ success: true, id: sent.id?._serialized || null });
  } catch (err) {
    console.error('Send error', err);
    // store failure in DB
    try {
      await pool.query(
        `INSERT INTO messages (broadcast_id, customer_id, phone, body, status, error_text, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
        [broadcastId, customerId, number, message, 'failed', err.message]
      );
    } catch (_) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// Broadcast endpoint
router.post('/broadcast', async (req, res) => {
  const { numbers, message, broadcastName = 'Broadcast' } = req.body;
  if (!Array.isArray(numbers) || numbers.length === 0) return res.status(400).json({ error: 'numbers array required' });

  // create broadcast record
  let broadcastId = null;
  try {
    const r = await pool.query(
      `INSERT INTO broadcasts (name, message, created_at) VALUES ($1,$2,now()) RETURNING id`,
      [broadcastName, message]
    );
    broadcastId = r.rows[0].id;
  } catch (err) {
    console.warn('Could not create broadcast record', err);
  }

  const results = [];
  for (const num of numbers) {
    try {
      const chatId = `${num}@c.us`;
      const r = await client.sendMessage(chatId, message);
      // save per-message record
      await pool.query(
        `INSERT INTO messages (broadcast_id, phone, body, whatsapp_message_id, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,now(),now())`,
        [broadcastId, num, message, r.id?._serialized || null, 'sent']
      );
      results.push({ number: num, status: 'sent' });
    } catch (err) {
      results.push({ number: num, status: 'failed', error: err.message });
      try {
        await pool.query(
          `INSERT INTO messages (broadcast_id, phone, body, status, error_text, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,now(),now())`,
          [broadcastId, num, message, 'failed', err.message]
        );
      } catch (_) {}
    }
  }

  res.json({ broadcastId, results });
});

export default router;
