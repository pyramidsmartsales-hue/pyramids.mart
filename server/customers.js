// server/routes/customers.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

// Create customer
router.post('/', async (req, res) => {
  const { name, phone, email, metadata } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO customers (name, phone, email, metadata) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name || null, phone, email || null, metadata ? JSON.stringify(metadata) : null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('DB insert error', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// Get customers
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('DB select error', err);
    res.status(500).json({ error: 'DB error' });
  }
});

export default router;
