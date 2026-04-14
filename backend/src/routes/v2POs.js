import { Router } from 'express';
import { query } from '../db.js';
import { requireSession } from '../middleware/session.js';

export const router = Router();

const LOCATION_ID = process.env.SHOPIFY_LOCATION_ID || '1';

async function shopifyRest(method, path, body) {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2024-10';

  if (!token || !domain) throw new Error('Shopify not configured');

  const res = await fetch(`https://${domain}/admin/api/${apiVersion}${path}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    const err = new Error(`Shopify ${method} ${path} → ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// GET /pos — return POs blob from kv_store
router.get('/pos', async (req, res) => {
  try {
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['pos']);
    const data = rows[0]?.value || [];
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('Error fetching POs:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /pos — upsert POs blob
router.post('/pos', async (req, res) => {
  const pos = Array.isArray(req.body) ? req.body : [];

  try {
    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['pos', JSON.stringify(pos)]
    );
    res.json(pos);
  } catch (err) {
    console.error('Error saving POs:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /receive-po — adjust inventory for received quantities
router.post('/receive-po', async (req, res) => {
  const { poId, lines } = req.body || {};

  if (!poId || !Array.isArray(lines)) {
    return res.status(400).json({ error: 'poId and lines array required' });
  }

  try {
    const results = [];

    for (const line of lines) {
      const { variantId, inventoryItemId, prevReceived, newReceived } = line;
      if (newReceived === prevReceived) {
        results.push({ variantId, ok: true, skipped: true });
        continue;
      }

      const delta = newReceived - prevReceived;
      try {
        await shopifyRest('POST', '/inventory_levels/adjust.json', {
          location_id: LOCATION_ID,
          inventory_item_id: inventoryItemId,
          available_adjustment: delta
        });
        results.push({ variantId, ok: true, newAvailable: newReceived });
      } catch (err) {
        console.error(`Inventory adjust failed for ${variantId}:`, err);
        results.push({ variantId, ok: false, error: err.message });
      }
    }

    res.json({ ok: true, results });
  } catch (err) {
    console.error('Receive PO error:', err);
    res.status(500).json({ error: err.message });
  }
});
