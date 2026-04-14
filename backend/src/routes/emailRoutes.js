import { Router } from 'express';
import { query } from '../db.js';
import { requireSession, requireAdmin } from '../middleware/session.js';
import { sendInvoiceEmail, sendProformaEmail, sendLowStockAlert } from '../services/email.js';

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

// POST /send-invoice/:orderId — email invoice link
router.post('/send-invoice/:orderId', requireAdmin, async (req, res) => {
  const { email, name } = req.body || {};

  if (!email || !name) {
    return res.status(400).json({ error: 'Email and name required' });
  }

  try {
    await sendInvoiceEmail(email, name, req.params.orderId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Send invoice error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /send-proforma/:draftId — email proforma link
router.post('/send-proforma/:draftId', requireAdmin, async (req, res) => {
  const { email, name } = req.body || {};

  if (!email || !name) {
    return res.status(400).json({ error: 'Email and name required' });
  }

  try {
    await sendProformaEmail(email, name, req.params.draftId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Send proforma error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /send-low-stock-alert — email low stock alert to admin
router.post('/send-low-stock-alert', requireAdmin, async (req, res) => {
  try {
    // Fetch inventory and stock settings
    const token = process.env.SHOPIFY_ADMIN_TOKEN;
    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    if (!token || !domain) {
      return res.status(500).json({ error: 'Shopify not configured' });
    }

    // Get stock settings
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['stock_settings']);
    const stockSettings = rows[0]?.value || {};

    // Get inventory (simplified: fetch all variants and their inventory)
    const data = await shopifyRest('GET', '/inventory_items.json?limit=250');
    const items = [];

    for (const invItem of (data.inventory_items || [])) {
      const vid = invItem.id;
      const vidStr = String(vid);
      const threshold = parseInt(stockSettings[vidStr]?.threshold) || 5;

      // Get inventory level for this item (simplified — just use quantity)
      const levelData = await shopifyRest('GET', `/inventory_items/${vid}/inventory_levels.json`);
      const level = levelData.inventory_levels?.[0];
      const available = level?.available || 0;

      if (available <= threshold) {
        items.push({
          sku: invItem.sku,
          name: invItem.requires_shipping ? 'Product' : 'Item',
          available,
          threshold
        });
      }
    }

    if (items.length > 0) {
      await sendLowStockAlert(items);
    }

    res.json({ ok: true, count: items.length });
  } catch (err) {
    console.error('Low stock alert error:', err);
    res.status(500).json({ error: err.message });
  }
});
