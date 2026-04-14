import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scryptSync } from 'node:crypto';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Helper to hash password using scrypt
function hashPassword(password) {
  const salt = Buffer.alloc(16, 'salt');
  return scryptSync(password, salt, 32).toString('hex');
}

async function seedUsers() {
  // Check if users already exist
  const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM users');
  if (rows[0].cnt > 0) {
    console.log('✓ users already exist, skipping seed');
    return;
  }

  const defaultUsers = [
    { email: 'tom@nuvio.com.au', name: 'Tom', role: 'admin', pass: 'Nuvio2026!' },
    { email: 'info@nuvio.com.au', name: 'Info', role: 'admin', pass: 'Nuvio2026!' },
    { email: 'sales@nuvio.com.au', name: 'Sales', role: 'staff', pass: 'Sales2026!' }
  ];

  for (const user of defaultUsers) {
    const hash = hashPassword(user.pass);
    await pool.query(
      'INSERT INTO users (email, pass_hash, name, role, commission) VALUES ($1,$2,$3,$4,0)',
      [user.email, hash, user.name, user.role]
    );
    console.log(`  → seeded user: ${user.email}`);
  }
}

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const { rows } = await pool.query('SELECT name FROM _migrations');
  const done = new Set(rows.map(r => r.name));

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (done.has(file)) {
      console.log(`✓ already applied: ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`→ applying ${file}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ failed ${file}`, err);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  // Seed users after migrations
  await seedUsers();

  console.log('✓ migrations complete');
  await pool.end();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
