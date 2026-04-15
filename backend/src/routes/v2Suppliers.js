import { Router } from 'express';
import { query } from '../db.js';

export const router = Router();

// GET /suppliers — return suppliers blob keyed by vendor name
router.get('/suppliers', async (req, res) => {
  try {
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['suppliers']);
    const data = rows[0]?.value || {};
    res.json(data);
  } catch (err) {
    console.error('Error fetching suppliers:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /suppliers — upsert suppliers blob (keyed by vendor name)
// Body shape: { "VendorName": { contact, email, phone, address, notes } }
router.post('/suppliers', async (req, res) => {
  const incoming = req.body || {};

  try {
    // Merge with existing
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['suppliers']);
    const existing = rows[0]?.value || {};
    const merged = { ...existing, ...incoming };

    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['suppliers', JSON.stringify(merged)]
    );

    res.json(merged);
  } catch (err) {
    console.error('Error saving suppliers:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /suppliers/:vendor — update a single vendor's supplier record
router.put('/suppliers/:vendor', async (req, res) => {
  const vendor = req.params.vendor;
  const payload = req.body || {};

  try {
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['suppliers']);
    const existing = rows[0]?.value || {};
    existing[vendor] = { ...(existing[vendor] || {}), ...payload };

    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['suppliers', JSON.stringify(existing)]
    );

    res.json(existing[vendor]);
  } catch (err) {
    console.error('Error updating supplier:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /suppliers/:vendor — remove a supplier
router.delete('/suppliers/:vendor', async (req, res) => {
  const vendor = req.params.vendor;

  try {
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['suppliers']);
    const existing = rows[0]?.value || {};
    delete existing[vendor];

    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['suppliers', JSON.stringify(existing)]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting supplier:', err);
    res.status(500).json({ error: err.message });
  }
});
