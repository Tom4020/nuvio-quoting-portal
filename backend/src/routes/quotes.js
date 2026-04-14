import { Router } from 'express';
import { pool, query } from '../db.js';
import { nextQuoteNumber } from '../services/numbering.js';
import { streamQuotePdf } from '../services/pdf.js';
import { createDraftOrderFromQuote } from '../services/shopify.js';

export const router = Router();

// GET /api/quotes — list
router.get('/', async (req, res) => {
  const { rows } = await query(`
    SELECT q.*, c.name AS customer_name, c.email AS customer_email, c.company AS customer_company
    FROM quotes q
    LEFT JOIN customers c ON c.id = q.customer_id
    ORDER BY q.created_at DESC
    LIMIT 200
  `);
  res.json(rows);
});

// GET /api/quotes/:id — detail with items
router.get('/:id', async (req, res) => {
  const quote = await loadQuote(req.params.id);
  if (!quote) return res.status(404).json({ error: 'Not found' });
  res.json(quote);
});

// POST /api/quotes — create (upserts customer by email if provided)
router.post('/', async (req, res) => {
  const {
    customer,          // { name, email, company, phone, shopify_id }
    items = [],        // [{ title, sku, unit_price, quantity, description, shopify_variant_id }]
    notes,
    discount = 0,
    tax_rate = 0.10,
    currency = 'AUD',
    valid_until,
    created_by
  } = req.body || {};

  if (!items.length) return res.status(400).json({ error: 'At least one line item required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let customerId = null;
    if (customer && (customer.name || customer.email)) {
      const cRes = await client.query(
        `INSERT INTO customers (name, email, phone, company, shopify_id)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (shopify_id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email
         RETURNING id`,
        [customer.name || customer.email, customer.email || null, customer.phone || null, customer.company || null, customer.shopify_id || null]
      );
      customerId = cRes.rows[0].id;
    }

    const { subtotal, tax, total } = computeTotals(items, discount, tax_rate);
    const quote_number = await nextQuoteNumber();

    const qRes = await client.query(
      `INSERT INTO quotes (quote_number, customer_id, status, currency, subtotal, discount, tax_rate, tax, total, notes, valid_until, created_by)
       VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [quote_number, customerId, currency, subtotal, discount, tax_rate, tax, total, notes || null, valid_until || null, created_by || null]
    );
    const quote = qRes.rows[0];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const lineTotal = Number(it.unit_price || 0) * Number(it.quantity || 1);
      await client.query(
        `INSERT INTO quote_items (quote_id, shopify_variant_id, sku, title, description, quantity, unit_price, line_total, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [quote.id, it.shopify_variant_id || null, it.sku || null, it.title, it.description || null,
         it.quantity || 1, it.unit_price || 0, lineTotal, i]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(await loadQuote(quote.id));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/quotes/:id/status — change status (draft → sent → accepted etc.)
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['draft','sent','accepted','rejected','expired','converted'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const { rows } = await query(`UPDATE quotes SET status=$1 WHERE id=$2 RETURNING *`, [status, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// GET /api/quotes/:id/pdf — stream PDF
router.get('/:id/pdf', async (req, res) => {
  const quote = await loadQuote(req.params.id);
  if (!quote) return res.status(404).json({ error: 'Not found' });
  streamQuotePdf(res, { quote, items: quote.items, customer: quote.customer });
});

// POST /api/quotes/:id/convert — create a Shopify draft order and mark converted
router.post('/:id/convert', async (req, res) => {
  const quote = await loadQuote(req.params.id);
  if (!quote) return res.status(404).json({ error: 'Not found' });
  try {
    const draft = await createDraftOrderFromQuote(quote, quote.items, quote.customer);
    await query(
      `UPDATE quotes SET status='converted', shopify_draft_order_id=$1 WHERE id=$2`,
      [draft.id, quote.id]
    );
    res.json({ draft_order_id: draft.id, invoice_url: draft.invoice_url });
  } catch (err) {
    console.error('Shopify draft order failed', err);
    res.status(502).json({ error: 'Shopify draft order failed', detail: err.body || err.message });
  }
});

// ----- helpers -----
async function loadQuote(id) {
  const { rows } = await query(`SELECT * FROM quotes WHERE id=$1`, [id]);
  const quote = rows[0];
  if (!quote) return null;
  const items = (await query(
    `SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY position, id`, [id]
  )).rows;
  let customer = null;
  if (quote.customer_id) {
    customer = (await query(`SELECT * FROM customers WHERE id=$1`, [quote.customer_id])).rows[0] || null;
  }
  return { ...quote, items, customer };
}

function computeTotals(items, discount, tax_rate) {
  const subtotal = items.reduce((s, it) => s + Number(it.unit_price || 0) * Number(it.quantity || 1), 0);
  const taxable = Math.max(0, subtotal - Number(discount || 0));
  const tax = +(taxable * Number(tax_rate || 0)).toFixed(2);
  const total = +(taxable + tax).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), tax, total };
}
