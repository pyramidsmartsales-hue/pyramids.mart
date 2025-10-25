// routes/customers.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

router.post('/', async (req, res) => {
  const { name, phone, email, metadata } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO customers (name, phone, email, metadata) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name||null, phone, email||null, metadata ? JSON.stringify(metadata) : null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

export default router;
