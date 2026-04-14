import { Router } from 'express';
import { query } from '../db.js';
import { requireSession, requireAdmin } from '../middleware/session.js';

export const router = Router();

// GET /clients — return 30-day account clients blob
router.get('/', requireSession, async (req, res) => {
  try {
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['clients']);
    const data = rows[0]?.value || [];
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('Error fetching clients:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /clients — upsert clients blob (admin only)
router.post('/', requireSession, requireAdmin, async (req, res) => {
  const clients = Array.isArray(req.body) ? req.body : [];

  try {
    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['clients', JSON.stringify(clients)]
    );
    res.json(clients);
  } catch (err) {
    console.error('Error saving clients:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/client-balance?email=... — check credit limit and outstanding orders
router.get('/admin/client-balance', requireSession, requireAdmin, async (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    // Get clients from kv_store
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['clients']);
    const clients = (rows[0]?.value || []).filter(c => c.email === email);
    const client = clients[0];
    const creditLimit = client ? Number(client.creditLimit) || 0 : 0;

    // Search Shopify orders for this email with outstanding balance
    const token = process.env.SHOPIFY_ADMIN_TOKEN;
    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const apiVersion = process.env.SHOPIFY_API_VERSION || '2024-10';

    if (!token || !domain) {
      return res.json({ creditLimit, balance: 0, outstandingOrders: [] });
    }

    const gql = {
      query: `query {
        orders(first: 100, query: "email:${email} financial_status:(pending OR partially_paid)") {
          edges { node {
            id
            name
            totalPriceSet { shopMoney { amount } }
            createdAt
            financialStatus
          } }
        }
      }`
    };

    const shopifyRes = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(gql)
    });

    const data = await shopifyRes.json();
    const orders = data.data?.orders?.edges || [];

    const outstandingOrders = orders.map(({ node }) => ({
      id: node.id,
      name: node.name,
      total: Number(node.totalPriceSet.shopMoney.amount),
      createdAt: node.createdAt,
      financialStatus: node.financialStatus
    }));

    const balance = outstandingOrders.reduce((sum, o) => sum + o.total, 0);

    res.json({
      creditLimit,
      balance,
      outstandingOrders
    });
  } catch (err) {
    console.error('Client balance error:', err);
    res.status(500).json({ error: err.message });
  }
});
