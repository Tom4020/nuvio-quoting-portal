import { Router } from 'express';
import { query } from '../db.js';
import { requireSession } from '../middleware/session.js';

export const router = Router();

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

// GET /lead-times — return lead times blob
router.get('/lead-times', async (req, res) => {
  try {
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['lead_times']);
    const data = rows[0]?.value || {};
    res.json(data);
  } catch (err) {
    console.error('Error fetching lead times:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /lead-times — upsert lead times blob
router.post('/lead-times', async (req, res) => {
  const leadTimes = req.body || {};

  try {
    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['lead_times', JSON.stringify(leadTimes)]
    );
    res.json(leadTimes);
  } catch (err) {
    console.error('Error saving lead times:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /stock-settings — return stock settings blob
router.get('/stock-settings', async (req, res) => {
  try {
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['stock_settings']);
    const data = rows[0]?.value || {};
    res.json(data);
  } catch (err) {
    console.error('Error fetching stock settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /stock-settings — upsert stock settings blob
router.post('/stock-settings', async (req, res) => {
  const settings = req.body || {};

  try {
    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['stock_settings', JSON.stringify(settings)]
    );
    res.json(settings);
  } catch (err) {
    console.error('Error saving stock settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /sales?weeks=N — aggregate order line items sold in last N weeks
router.get('/sales', async (req, res) => {
  const weeks = parseInt(req.query.weeks) || 4;
  const cacheKey = `sales_cache_${weeks}_${new Date().toISOString().split('T')[0]}`;

  try {
    // Check cache first
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', [cacheKey]);
    if (rows[0]) {
      return res.json({ sales: rows[0].value });
    }

    // Fetch from Shopify: orders updated in last N weeks
    const since = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000).toISOString();
    let page = 1;
    let hasMore = true;
    const sales = {};

    while (hasMore && page <= 10) {
      const data = await shopifyRest('GET', `/orders.json?status=any&updated_at_min=${since}&limit=250&fields=line_items`);

      (data.orders || []).forEach(order => {
        (order.line_items || []).forEach(item => {
          const vid = item.variant_id;
          if (vid) {
            sales[String(vid)] = (sales[String(vid)] || 0) + item.quantity;
          }
        });
      });

      hasMore = (data.orders || []).length === 250;
      page++;
    }

    // Cache for 24h
    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      [cacheKey, JSON.stringify(sales)]
    ).catch(() => {});

    res.json({ sales });
  } catch (err) {
    console.error('Sales error:', err);
    res.status(500).json({ error: err.message });
  }
});
