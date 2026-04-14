import { Router } from 'express';
import { requireSession, requireAdmin } from '../middleware/session.js';

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

// GET /admin/orders — list orders
router.get('/admin/orders', requireAdmin, async (req, res) => {
  const limit = parseInt(req.query.limit) || 250;
  const status = req.query.status || 'any';

  try {
    const data = await shopifyRest('GET', `/orders.json?status=${status}&limit=${limit}&fields=id,name,email,customer,total,financial_status,fulfillment_status,created_at,line_items`);

    const orders = (data.orders || []).map(o => ({
      id: o.id,
      name: o.name,
      email: o.email,
      customerName: o.customer ? `${o.customer.first_name} ${o.customer.last_name}`.trim() : '',
      total: Number(o.total),
      status: o.fulfillment_status,
      financialStatus: o.financial_status,
      fulfillmentStatus: o.fulfillment_status,
      createdAt: o.created_at,
      paid: o.financial_status === 'paid',
      lineItems: (o.line_items || []).map(li => ({
        title: li.title,
        qty: li.quantity,
        price: Number(li.price),
        sku: li.sku
      }))
    }));

    res.json(orders);
  } catch (err) {
    console.error('Orders fetch error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /admin/order-detail/:id — fetch full order details
router.get('/admin/order-detail/:id', requireAdmin, async (req, res) => {
  try {
    const data = await shopifyRest('GET', `/orders/${req.params.id}.json`);
    const o = data.order;

    const order = {
      id: o.id,
      name: o.name,
      email: o.email,
      customerName: o.customer ? `${o.customer.first_name} ${o.customer.last_name}`.trim() : '',
      customer: o.customer ? {
        id: o.customer.id,
        firstName: o.customer.first_name,
        lastName: o.customer.last_name,
        email: o.customer.email,
        phone: o.customer.phone,
        address: {
          line1: o.shipping_address?.address1,
          line2: o.shipping_address?.address2,
          city: o.shipping_address?.city,
          state: o.shipping_address?.province,
          zip: o.shipping_address?.zip,
          country: o.shipping_address?.country
        }
      } : null,
      total: Number(o.total_price),
      subtotal: Number(o.subtotal_price),
      tax: Number(o.total_tax),
      discounts: Number(o.total_discounts),
      status: o.fulfillment_status,
      financialStatus: o.financial_status,
      fulfillmentStatus: o.fulfillment_status,
      createdAt: o.created_at,
      paid: o.financial_status === 'paid',
      lineItems: (o.line_items || []).map(li => ({
        id: li.id,
        title: li.title,
        variantId: li.variant_id,
        qty: li.quantity,
        price: Number(li.price),
        sku: li.sku,
        vendor: li.vendor
      })),
      shippingLines: (o.shipping_lines || []).map(sl => ({
        title: sl.title,
        price: Number(sl.price)
      }))
    };

    res.json(order);
  } catch (err) {
    console.error('Order detail error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /create-draft-order — create a draft order from request body
router.post('/create-draft-order', async (req, res) => {
  const { draft_order } = req.body || {};

  if (!draft_order) {
    return res.status(400).json({ error: 'draft_order object required' });
  }

  try {
    const data = await shopifyRest('POST', '/draft_orders.json', { draft_order });
    res.status(201).json({ draft_order: data.draft_order });
  } catch (err) {
    console.error('Draft order creation error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});
