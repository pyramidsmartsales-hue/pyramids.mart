// migrate.js
import dotenv from 'dotenv';
import pkg from 'pg';
const { Client } = pkg;
dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL not set. Set it in .env or environment variables.');
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

(async () => {
  try {
    await client.connect();
    console.log('Running migrations...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name TEXT,
        phone VARCHAR(50) NOT NULL,
        email TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS broadcasts (
        id SERIAL PRIMARY KEY,
        name TEXT,
        message TEXT,
        created_by TEXT,
        status VARCHAR(20) DEFAULT 'draft',
        scheduled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        broadcast_id INTEGER REFERENCES broadcasts(id) ON DELETE SET NULL,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        phone VARCHAR(50) NOT NULL,
        body TEXT,
        whatsapp_message_id TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        error_text TEXT,
        attempts INTEGER DEFAULT 0,
        last_attempt_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    console.log('Migrations finished.');
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err);
    await client.end().catch(()=>{});
    process.exit(1);
  }
})();
