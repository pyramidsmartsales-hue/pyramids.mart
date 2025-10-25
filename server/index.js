// server/index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import customersRouter from './routes/customers.js';
import sendRouter from './routes/send.js';
import pool from './db.js'; // تأكد أن db.js يصدّر pool كـ default

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Root route - صفحة الجذر تعرض رسالة بسيطة لتأكيد أن السيرفر يعمل
app.get('/', (req, res) => {
  res.send('✅ Pyramids Mart Server is running successfully!');
});

// Health check - يعيد حالة الاتصال بقاعدة البيانات ووقت السيرفر
app.get('/health', async (req, res) => {
  const up = {
    server: true,
    time: new Date().toISOString(),
    db: false
  };

  try {
    // نفّذ استعلام بسيط للتأكد من أن الاتصال يعمل
    await pool.query('SELECT 1');
    up.db = true;
    res.json({ status: 'ok', details: up });
  } catch (err) {
    console.error('Health DB check failed:', err.message || err);
    res.status(500).json({ status: 'error', details: up, error: err.message || err });
  }
});

// API routes
app.use('/api/customers', customersRouter);
app.use('/api/send', sendRouter);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('Server listening on', PORT);

  // عند بدء التشغيل حاول إنشاء اتصال سريع لقاعدة البيانات واطبع النتيجة
  try {
    // pool should be exported from db.js
    await pool.query('SELECT 1');
    console.log('✅ Connected to PostgreSQL successfully');
  } catch (err) {
    console.error('❌ Database connection error on startup:', err.message || err);
  }

  console.log('=> Your service is live 🎉');
});
