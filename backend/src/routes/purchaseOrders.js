import { Router } from 'express';
import { pool, query } from '../db.js';
import { nextPoNumber } from '../services/numbering.js';

export const router = Router();

// GET /api/purchase-orders
router.get('/', async (req, res) => {
  const { rows } = await query(`
    SELECT p.*, s.name AS supplier_name, s.email AS supplier_email
    FROM purchase_orders p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    ORDER BY p.created_at DESC
    LIMIT 200
  `);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const po = await loadPO(req.params.id);
  if (!po) return res.status(404).json({ error: 'Not found' });
  res.json(po);
});

// POST /api/purchase-orders
router.post('/', async (req, res) => {
  const {
    supplier,     // { name, email, phone }
    items = [],   // [{ title, sku, unit_cost, quantity }]
    notes,
    expected_date,
    currency = 'AUD',
    tax_rate = 0.10,
    created_by
  } = req.body || {};

  if (!items.length) return res.status(400).json({ error: 'At least one line item required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let supplierId = null;
    if (supplier && supplier.name) {
      const s = await client.query(
        `INSERT INTO suppliers (name, email, phone) VALUES ($1,$2,$3) RETURNING id`,
        [supplier.name, supplier.email || null, supplier.phone || null]
      );
      supplierId = s.rows[0].id;
    }

    const subtotal = items.reduce((s, it) => s + Number(it.unit_cost || 0) * Number(it.quantity || 1), 0);
    const tax = +(subtotal * Number(tax_rate || 0)).toFixed(2);
    const total = +(subtotal + tax).toFixed(2);
    const po_number = await nextPoNumber();

    const r = await client.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, status, currency, subtotal, tax, total, expected_date, notes, created_by)
       VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [po_number, supplierId, currency, subtotal.toFixed(2), tax, total, expected_date || null, notes || null, created_by || null]
    );
    const po = r.rows[0];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const lineTotal = Number(it.unit_cost || 0) * Number(it.quantity || 1);
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, sku, title, quantity, unit_cost, line_total, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [po.id, it.sku || null, it.title, it.quantity || 1, it.unit_cost || 0, lineTotal, i]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(await loadPO(po.id));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['draft','sent','partial','received','cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const { rows } = await query(`UPDATE purchase_orders SET status=$1 WHERE id=$2 RETURNING *`, [status, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// Mark a qty received on a line item
router.patch('/:id/items/:itemId/receive', async (req, res) => {
  const { qty_received } = req.body || {};
  const { rows } = await query(
    `UPDATE purchase_order_items SET qty_received=$1
     WHERE id=$2 AND purchase_order_id=$3 RETURNING *`,
    [Number(qty_received || 0), req.params.itemId, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

async function loadPO(id) {
  const { rows } = await query(`SELECT * FROM purchase_orders WHERE id=$1`, [id]);
  const po = rows[0];
  if (!po) return null;
  const items = (await query(
    `SELECT * FROM purchase_order_items WHERE purchase_order_id=$1 ORDER BY position, id`, [id]
  )).rows;
  let supplier = null;
  if (po.supplier_id) {
    supplier = (await query(`SELECT * FROM suppliers WHERE id=$1`, [po.supplier_id])).rows[0] || null;
  }
  return { ...po, items, supplier };
}
