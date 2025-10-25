import express from 'express';
import pool from '../db.js';
import multer from 'multer';
import fetch from 'node-fetch';


const router = express.Router();
const upload = multer({ dest: 'uploads/' });


// إنشاء جدول بسيط إذا لم يكن موجودًا (ملاحظة: في production استخدم migrations)
(async ()=>{
await pool.query(`
CREATE TABLE IF NOT EXISTS customers (
id SERIAL PRIMARY KEY,
name TEXT,
phone TEXT,
address TEXT,
created_at TIMESTAMP DEFAULT now()
);
`);
})();


// إضافة عميل
router.post('/', async (req, res) => {
const { name, phone, address } = req.body;
try {
const r = await pool.query(
'INSERT INTO customers (name, phone, address) VALUES ($1,$2,$3) RETURNING *',
[name, phone, address]
);
res.json(r.rows[0]);
} catch (e) {
res.status(500).json({ error: e.message });
}
});


// جلب كل العملاء
router.get('/', async (req, res) => {
try {
const r = await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
res.json(r.rows);
} catch (e) {
res.status(500).json({ error: e.message });
}
});


export default router;