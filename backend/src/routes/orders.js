import { Router } from 'express';
import { query } from '../db.js';

export const router = Router();

// GET /api/orders — list internal orders (mirrors of Shopify orders + our fulfilment state)
router.get('/', async (req, res) => {
  const { rows } = await query(`
    SELECT o.*, c.name AS customer_name, c.email AS customer_email
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    ORDER BY o.created_at DESC
    LIMIT 200
  `);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(`SELECT * FROM orders WHERE id=$1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.patch('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['new','processing','packed','shipped','delivered','cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const { rows } = await query(`UPDATE orders SET status=$1 WHERE id=$2 RETURNING *`, [status, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.patch('/:id/notes', async (req, res) => {
  const { notes } = req.body || {};
  const { rows } = await query(`UPDATE orders SET notes=$1 WHERE id=$2 RETURNING *`, [notes || null, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});
