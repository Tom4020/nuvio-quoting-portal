import { Router } from 'express';
import { searchProducts } from '../services/shopify.js';

export const router = Router();

// GET /api/shopify/products?q=...  — used by the quote builder's product picker
router.get('/products', async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const limit = Math.min(50, Number(req.query.limit || 25));
    const variants = await searchProducts({ q, limit });
    res.json(variants);
  } catch (err) {
    console.error('Shopify product search failed', err);
    res.status(502).json({ error: 'Shopify product search failed', detail: err.body || err.message });
  }
});
