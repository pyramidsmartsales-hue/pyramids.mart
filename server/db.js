// db.js
import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config();
const { Pool } = pkg;

// إذا لم يكن DATABASE_URL موجودًا، جرب روابط بديلة (مفيدة إذا وضعت Internal/External URL بشكل منفصل)
const rawDatabaseUrl =
  process.env.DATABASE_URL ||
  process.env.INTERNAL_DATABASE_URL ||
  process.env.EXTERNAL_DATABASE_URL ||
  '';

// تحذير سريع لو لم يتم تعيين أي رابط
if (!rawDatabaseUrl) {
  console.warn('⚠️  No DATABASE_URL / INTERNAL_DATABASE_URL / EXTERNAL_DATABASE_URL found in environment.');
  console.warn('Please set one of these environment variables with your Postgres connection string.');
}

const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';

// توصيات SSL: عند التشغيل في production نستخدم ssl مع rejectUnauthorized=false (شائع مع Render)
const poolConfig = {
  connectionString: rawDatabaseUrl || undefined,
  // إذا لم يتم تمرير connectionString، سيستخدم pg إعدادات افتراضية (مثلاً من PGHOST/PGUSER)
  ssl: isProduction
    ? { rejectUnauthorized: false }
    : false,
  // يمكنك إضافة إعدادات أخرى هنا إن احتجت (max, idleTimeoutMillis, ...)
};

// إنشاء Pool مع حماية من حالة عدم وجود connectionString
let pool;
try {
  pool = new Pool(poolConfig);
} catch (err) {
  // هذا نادراً ما يحدث لكن من الأفضل التقاطه وطباعته
  console.error('❌ Failed to create Postgres pool:', err && err.message ? err.message : err);
  throw err;
}

// سجل أخطاء الاتصالات العامة
pool.on('error', (err) => {
  console.error('⚠️  Unexpected error on idle Postgres client:', err && err.message ? err.message : err);
});

// دالة اختبار اتصال مفيدة للاستخدام أثناء التشغيل أو من health check
async function testConnection() {
  if (!rawDatabaseUrl) {
    throw new Error('DATABASE_URL (or INTERNAL_DATABASE_URL / EXTERNAL_DATABASE_URL) is not set');
  }
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}

export { testConnection };
export default pool;
