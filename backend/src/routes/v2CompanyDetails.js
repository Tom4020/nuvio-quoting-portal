import { Router } from 'express';
import { query } from '../db.js';

export const router = Router();

// GET /company-details — return Nuvio's own business details
router.get('/company-details', async (req, res) => {
  try {
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['company_details']);
    const data = rows[0]?.value || {};
    res.json(data);
  } catch (err) {
    console.error('Error fetching company details:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /company-details — upsert Nuvio's own business details
// Body: { name, tradingName, contact, email, phone, address, abn, website, logoUrl, notes }
router.put('/company-details', async (req, res) => {
  const payload = req.body || {};

  try {
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['company_details']);
    const existing = rows[0]?.value || {};
    const merged = { ...existing, ...payload };

    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['company_details', JSON.stringify(merged)]
    );

    res.json(merged);
  } catch (err) {
    console.error('Error saving company details:', err);
    res.status(500).json({ error: err.message });
  }
});
