import { Router } from 'express';
import { query } from '../db.js';
import { requireSession } from '../middleware/session.js';
import { streamPurchaseOrderPdf } from '../services/pdf.js';

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

// Helper: load and save kv_store blob
async function kvGet(key, fallback) {
  const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', [key]);
  return rows[0]?.value ?? fallback;
}
async function kvSet(key, value) {
  await query(
    `INSERT INTO kv_store (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

// Sequential PO numbering starting from 150 → PO000150, PO000151, …
const PO_START = 150;
async function nextPONumber(posArr) {
  const counterRaw = await kvGet('po_counter', null);
  let next = Number(counterRaw);
  if (!Number.isFinite(next) || next < PO_START) {
    // Derive from any existing POs so we never collide with pre-existing numbers
    const highest = posArr
      .map(p => {
        const m = /^PO(\d{6,})$/.exec(String(p.poNumber || ''));
        return m ? parseInt(m[1], 10) : 0;
      })
      .reduce((a, b) => Math.max(a, b), 0);
    next = Math.max(PO_START, highest + 1);
  }
  const poNumber = `PO${String(next).padStart(6, '0')}`;
  await kvSet('po_counter', next + 1);
  return poNumber;
}

// POST /make-po — generate one PO per vendor from a quote's items
// Body: { quoteNumber, items: [{ vendor, sku, title, description, quantity, buy_ex, image_url, variantId }], notes? }
router.post('/make-po', async (req, res) => {
  const { quoteNumber, items, notes } = req.body || {};

  if (!quoteNumber || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'quoteNumber and items required' });
  }

  try {
    // Group items by vendor
    const byVendor = {};
    for (const it of items) {
      const vendor = (it.vendor || 'Unknown').trim() || 'Unknown';
      if (!byVendor[vendor]) byVendor[vendor] = [];
      const qty = Number(it.quantity) || 0;
      const buy = Number(it.buy_ex) || 0;
      byVendor[vendor].push({
        sku: it.sku || '',
        title: it.title || '',
        description: it.description || it.title || '',
        image_url: it.image_url || '',
        variantId: it.variantId || null,
        quantity: qty,
        buy_ex: buy,
        line_total: +(qty * buy).toFixed(2)
      });
    }

    // Load suppliers + existing POs
    const suppliers = await kvGet('suppliers', {});
    const existingPOs = await kvGet('pos', []);
    const posArr = Array.isArray(existingPOs) ? existingPOs : [];

    const created = [];

    for (const [vendor, vItems] of Object.entries(byVendor)) {
      const poNumber = await nextPONumber(posArr);

      const subtotal = +vItems.reduce((s, it) => s + it.line_total, 0).toFixed(2);
      const gst = +(subtotal * 0.10).toFixed(2);
      const total = +(subtotal + gst).toFixed(2);

      const supplierRecord = suppliers[vendor] || null;
      // Snapshot payment terms onto the PO so it stays stable if the supplier card changes later
      const paymentTerms = (supplierRecord && supplierRecord.paymentTerms) || '';

      const po = {
        poNumber,
        quoteNumber,
        vendor,
        supplier: supplierRecord,
        paymentTerms,
        date: new Date().toISOString(),
        status: 'draft',
        currency: 'AUD',
        items: vItems,
        subtotal,
        gst,
        total,
        notes: notes || '',
        received: {} // { variantId: qty } for /receive-po
      };

      posArr.push(po);
      created.push(po);
    }

    await kvSet('pos', posArr);

    res.json({ ok: true, pos: created });
  } catch (err) {
    console.error('Make PO error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /pos/:poNumber/pdf — stream the PO as a PDF
router.get('/pos/:poNumber/pdf', async (req, res) => {
  try {
    const pos = await kvGet('pos', []);
    const posArr = Array.isArray(pos) ? pos : [];
    const po = posArr.find(p => p.poNumber === req.params.poNumber);
    if (!po) return res.status(404).json({ error: 'PO not found' });

    // Re-fetch supplier in case it was updated after PO was created
    if (!po.supplier && po.vendor) {
      const suppliers = await kvGet('suppliers', {});
      po.supplier = suppliers[po.vendor] || null;
    }

    // Load Nuvio's own company details from kv_store (with env fallback inside pdf.js)
    const company = await kvGet('company_details', null);

    await streamPurchaseOrderPdf(res, { po, company });
  } catch (err) {
    console.error('PO PDF error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /pos/:poNumber — remove a PO from the kv blob
router.delete('/pos/:poNumber', async (req, res) => {
  try {
    const pos = await kvGet('pos', []);
    const posArr = Array.isArray(pos) ? pos : [];
    const next = posArr.filter(p => p.poNumber !== req.params.poNumber);
    await kvSet('pos', next);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete PO error:', err);
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
