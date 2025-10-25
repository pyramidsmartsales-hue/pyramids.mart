// index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import customersRouter from './routes/customers.js';
import sendRouter from './routes/send.js';
import pool from './db.js';
import './whatsapp.js'; // يبدأ عميل واتساب عند الاستيراد (QR يظهر في console)

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // للـ dashboard files في مجلد public

// Root page
app.get('/', (req, res) => {
  res.send('✅ Pyramids Mart Server is running successfully!');
});

// Health
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: true, time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', db: false, error: err.message });
  }
});

// APIs
app.use('/api/customers', customersRouter);
app.use('/api/send', sendRouter);

// Serve dashboard (single page app)
/*
  Put your frontend files under server/public/
  - public/index.html
  - public/app.js
*/

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('Server listening on', PORT);
  // test db
  try {
    await pool.query('SELECT 1');
    console.log('✅ Connected to PostgreSQL successfully');
  } catch (err) {
    console.error('❌ DB connection error:', err.message || err);
  }
  console.log('=> Your service is live 🎉');
});
