import express from 'express';
import pool from '../db.js';
import qrcode from 'qrcode-terminal';
import { Client, LocalAuth } from 'whatsapp-web.js';

const router = express.Router();

// إنشاء عميل واتساب
const client = new Client({
  authStrategy: new LocalAuth(), // يحفظ الجلسة فلا تحتاج QR كل مرة
});

client.on('qr', qr => {
  console.log('امسح هذا QR لتسجيل الدخول:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ واتساب متصل بنجاح!');
});

client.initialize();

// إرسال الرسائل لكل الأرقام
router.post('/to-all', async (req, res) => {
  const { text } = req.body;
  try {
    const result = await pool.query('SELECT phone FROM customers');
    const phones = result.rows.map(r => r.phone);

    for (const p of phones) {
      await client.sendMessage(p, text);
      console.log(`✅ تم الإرسال إلى ${p}`);
    }

    res.json({ message: 'تم الإرسال إلى جميع العملاء.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
