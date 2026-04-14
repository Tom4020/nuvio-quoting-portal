import express from 'express';
import crypto from 'crypto';

export const router = express.Router();

// GET /auth/install?shop=36bb0d-2.myshopify.com
// Starts the OAuth install flow.
router.get('/install', (req, res) => {
  const shop = String(req.query.shop || '');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return res
      .status(400)
      .send('Missing/invalid ?shop=<yourstore>.myshopify.com');
  }
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  if (!clientId) return res.status(500).send('SHOPIFY_CLIENT_ID not set');

  const scopes = [
    'read_customers',
    'write_draft_orders',
    'read_draft_orders',
    'read_orders',
    'read_product_listings',
    'read_products',
  ].join(',');

  const appUrl =
    process.env.APP_URL ||
    `https://${req.get('host')}`; // falls back to current host
  const redirectUri = `${appUrl}/auth/callback`;
  const state = crypto.randomBytes(16).toString('hex');

  const url =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  res.redirect(url);
});

// GET /auth/callback?code=...&shop=...
// Exchanges the code for a permanent Admin API access token and shows it.
router.get('/callback', async (req, res) => {
  try {
    const shop = String(req.query.shop || '');
    const code = String(req.query.code || '');
    if (!shop || !code) return res.status(400).send('Missing shop or code');

    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res
        .status(500)
        .send('SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET not set');
    }

    const tokenResp = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      }
    );

    const text = await tokenResp.text();
    if (!tokenResp.ok) {
      return res
        .status(500)
        .send(`Token exchange failed (${tokenResp.status}): ${text}`);
    }

    const data = JSON.parse(text);
    const token = data.access_token;

    // Log it too so you can also grab it from Railway logs
    console.log('SHOPIFY ADMIN TOKEN for', shop, '=', token);

    res.set('Content-Type', 'text/html');
    res.send(`<!doctype html>
<html><body style="font-family: -apple-system, sans-serif; padding: 40px; max-width: 720px;">
  <h2>Shopify Admin API Access Token</h2>
  <p>Shop: <code>${shop}</code></p>
  <p>Copy this value and paste it into Railway → backend service → Variables →
     <code>SHOPIFY_ADMIN_TOKEN</code>.</p>
  <pre style="background:#111;color:#0f0;padding:20px;border-radius:8px;
              font-size:15px;word-break:break-all;white-space:pre-wrap;">${token}</pre>
  <p style="color:#900">After copying, remove the /auth routes (or redeploy without them) so this cannot be replayed.</p>
</body></html>`);
  } catch (e) {
    console.error(e);
    res.status(500).send(`Error: ${e.message}`);
  }
});
