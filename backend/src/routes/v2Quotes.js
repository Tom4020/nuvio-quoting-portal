import { Router } from 'express';
import { query } from '../db.js';
import { requireSession } from '../middleware/session.js';

export const router = Router();

// GET /quotes — return blob from kv_store (Zephra-style array)
router.get('/', requireSession, async (req, res) => {
  try {
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['quotes']);
    const data = rows[0]?.value || [];
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('Error fetching quotes:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /quotes — upsert blob to kv_store
router.post('/', requireSession, async (req, res) => {
  const quotes = Array.isArray(req.body) ? req.body : [];

  try {
    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['quotes', JSON.stringify(quotes)]
    );
    res.json(quotes);
  } catch (err) {
    console.error('Error saving quotes:', err);
    res.status(500).json({ error: err.message });
  }
});
