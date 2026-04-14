import { Router } from 'express';

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

function renderInvoiceHtml(order) {
  const companyName = process.env.COMPANY_NAME || 'Nuvio';
  const companyEmail = process.env.COMPANY_EMAIL || 'sales@nuvio.com.au';
  const appUrl = process.env.APP_URL || 'https://nuvio.com';

  const lineItems = (order.line_items || []).map(li =>
    `<tr>
      <td style="padding:8px;border-bottom:1px solid #e0e0e0;">${li.title}</td>
      <td style="padding:8px;border-bottom:1px solid #e0e0e0;text-align:right;">${li.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #e0e0e0;text-align:right;">$${Number(li.price).toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #e0e0e0;text-align:right;">$${(li.quantity * li.price).toFixed(2)}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0e0e0e; line-height: 1.5; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .header { background: #1e4e1c; color: white; padding: 20px; margin-bottom: 30px; border-radius: 6px; }
    .header h1 { margin: 0; font-size: 28px; }
    .section { margin-bottom: 30px; }
    .label { font-size: 12px; color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; }
    .summary { background: #f7f7f7; padding: 16px; border-radius: 6px; }
    .row { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .total { font-weight: 600; font-size: 16px; color: #1e4e1c; border-top: 2px solid #1e4e1c; padding-top: 8px; }
    .button { display: inline-block; background: #1e4e1c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Invoice</h1>
      <p style="margin: 8px 0 0; opacity: 0.9;">Order #${order.name}</p>
    </div>

    <div class="section">
      <div class="label">Bill To</div>
      <p style="margin: 0;">${order.customer?.firstName || ''} ${order.customer?.lastName || ''}</p>
      <p style="margin: 4px 0 0; color: #6b6b6b;">${order.email}</p>
    </div>

    <div class="section">
      <table>
        <thead>
          <tr style="background: #f7f7f7;">
            <th style="padding: 8px; text-align: left; font-size: 12px; font-weight: 600;">Item</th>
            <th style="padding: 8px; text-align: right; font-size: 12px; font-weight: 600;">Qty</th>
            <th style="padding: 8px; text-align: right; font-size: 12px; font-weight: 600;">Price</th>
            <th style="padding: 8px; text-align: right; font-size: 12px; font-weight: 600;">Total</th>
          </tr>
        </thead>
        <tbody>${lineItems}</tbody>
      </table>
    </div>

    <div class="summary">
      <div class="row">
        <span>Subtotal</span>
        <span>$${Number(order.subtotal || 0).toFixed(2)}</span>
      </div>
      ${order.tax ? `<div class="row">
        <span>Tax</span>
        <span>$${Number(order.tax).toFixed(2)}</span>
      </div>` : ''}
      <div class="row total">
        <span>Total</span>
        <span>$${Number(order.total).toFixed(2)}</span>
      </div>
    </div>

    <p style="color: #6b6b6b; font-size: 13px; margin-top: 30px;">Questions? Contact us at ${companyEmail}</p>
  </div>
</body>
</html>`;
}

function renderProformaHtml(draftOrder) {
  const companyName = process.env.COMPANY_NAME || 'Nuvio';
  const companyEmail = process.env.COMPANY_EMAIL || 'sales@nuvio.com.au';

  const lineItems = (draftOrder.line_items || []).map(li =>
    `<tr>
      <td style="padding:8px;border-bottom:1px solid #e0e0e0;">${li.title}</td>
      <td style="padding:8px;border-bottom:1px solid #e0e0e0;text-align:right;">${li.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #e0e0e0;text-align:right;">$${Number(li.price).toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #e0e0e0;text-align:right;">$${(li.quantity * li.price).toFixed(2)}</td>
    </tr>`
  ).join('');

  const total = (draftOrder.line_items || []).reduce((sum, li) => sum + (li.quantity * li.price), 0);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0e0e0e; line-height: 1.5; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .header { background: #1e4e1c; color: white; padding: 20px; margin-bottom: 30px; border-radius: 6px; }
    .header h1 { margin: 0; font-size: 28px; }
    .section { margin-bottom: 30px; }
    .label { font-size: 12px; color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; }
    .summary { background: #f7f7f7; padding: 16px; border-radius: 6px; }
    .row { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .total { font-weight: 600; font-size: 16px; color: #1e4e1c; border-top: 2px solid #1e4e1c; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Proforma Invoice</h1>
    </div>

    <div class="section">
      <table>
        <thead>
          <tr style="background: #f7f7f7;">
            <th style="padding: 8px; text-align: left; font-size: 12px; font-weight: 600;">Item</th>
            <th style="padding: 8px; text-align: right; font-size: 12px; font-weight: 600;">Qty</th>
            <th style="padding: 8px; text-align: right; font-size: 12px; font-weight: 600;">Price</th>
            <th style="padding: 8px; text-align: right; font-size: 12px; font-weight: 600;">Total</th>
          </tr>
        </thead>
        <tbody>${lineItems}</tbody>
      </table>
    </div>

    <div class="summary">
      <div class="row total">
        <span>Total</span>
        <span>$${Number(total).toFixed(2)}</span>
      </div>
    </div>

    <p style="color: #6b6b6b; font-size: 13px; margin-top: 30px;">Questions? Contact us at ${companyEmail}</p>
  </div>
</body>
</html>`;
}

// GET /invoice/:orderId — serve invoice page
router.get('/invoice/:orderId', async (req, res) => {
  try {
    const data = await shopifyRest('GET', `/orders/${req.params.orderId}.json`);
    const order = data.order;

    const html = renderInvoiceHtml({
      name: order.name,
      email: order.email,
      customer: order.customer ? {
        firstName: order.customer.first_name,
        lastName: order.customer.last_name
      } : null,
      subtotal: order.subtotal_price,
      tax: order.total_tax,
      total: order.total_price,
      line_items: order.line_items
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Invoice render error:', err);
    res.status(err.status || 500).send(`<p>Failed to load invoice: ${err.message}</p>`);
  }
});

// GET /proforma/:draftId — serve proforma page
router.get('/proforma/:draftId', async (req, res) => {
  try {
    const data = await shopifyRest('GET', `/draft_orders/${req.params.draftId}.json`);
    const draftOrder = data.draft_order;

    const html = renderProformaHtml(draftOrder);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Proforma render error:', err);
    res.status(err.status || 500).send(`<p>Failed to load proforma: ${err.message}</p>`);
  }
});

// GET /pay/:orderId — redirect to checkout or payment page
router.get('/pay/:orderId', async (req, res) => {
  try {
    const data = await shopifyRest('GET', `/orders/${req.params.orderId}.json`);
    const order = data.order;

    // If there's an invoice URL, redirect to it; otherwise show a contact message
    if (order.invoice_url) {
      return res.redirect(order.invoice_url);
    }

    // Fallback: show a simple contact page
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0e0e0e; }
    .container { max-width: 500px; margin: 40px auto; padding: 20px; text-align: center; }
    .header { font-size: 24px; font-weight: 600; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <p class="header">Ready to Pay</p>
    <p>Thank you for your order! Please contact us to complete payment.</p>
    <p><a href="mailto:${process.env.COMPANY_EMAIL || 'sales@nuvio.com.au'}">Contact Sales</a></p>
  </div>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Pay page error:', err);
    res.status(err.status || 500).send(`<p>Failed to process payment: ${err.message}</p>`);
  }
});
