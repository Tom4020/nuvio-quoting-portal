import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { requirePortalToken } from './middleware/auth.js';
import { requireSession, requireAdmin } from './middleware/session.js';

// v1 routes (portal-token auth)
import { router as quotesRouter } from './routes/quotes.js';
import { router as posRouter } from './routes/purchaseOrders.js';
import { router as ordersRouter } from './routes/orders.js';
import { router as shopifyRouter } from './routes/shopify.js';

// v2 routes (session/JWT auth)
import { router as v2AuthRouter } from './routes/v2Auth.js';
import { router as usersRouter } from './routes/users.js';
import { router as v2QuotesRouter } from './routes/v2Quotes.js';
import { router as customersRouter } from './routes/customers.js';
import { router as clientsRouter } from './routes/clients.js';
import { router as productsRouter } from './routes/products.js';
import { router as v2POsRouter } from './routes/v2POs.js';
import { router as v2SuppliersRouter } from './routes/v2Suppliers.js';
import { router as costsRouter } from './routes/costs.js';
import { router as forecastRouter } from './routes/forecast.js';
import { router as v2OrdersRouter } from './routes/v2Orders.js';
import { router as emailRouter } from './routes/emailRoutes.js';
import { router as publicPagesRouter } from './routes/publicPages.js';
import { router as claudeProxyRouter } from './routes/claudeProxy.js';

const app = express();

app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev'));
app.use(express.json({ limit: '10mb' }));

const allowed = (process.env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.includes('*') || allowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  allowedHeaders: ['Content-Type', 'x-portal-token', 'Authorization'],
  methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS']
}));

// Health check (no auth) — Railway uses this
app.get('/healthz', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── v2 PUBLIC ROUTES (no auth) ──
app.use(publicPagesRouter); // GET /invoice/:id, /proforma/:id, /pay/:id
app.use(v2AuthRouter);     // POST /login, /verify-otp

// ── v2 SESSION-REQUIRED ROUTES ──
app.use('/users', requireSession, usersRouter);
app.use('/quotes', requireSession, v2QuotesRouter);
app.use('/customers', requireSession, customersRouter);
app.use('/clients', requireSession, clientsRouter);

// Products: /products, /inventory, /manage-products[/:id], /manage-variants/:id, /manage-products/:id/images[/:imageId]
// All handled by productsRouter (needs custom route definitions to match paths)
// For now, mount at root and let router handle all paths
app.use('/', requireSession, productsRouter);

// POs: /pos, /receive-po, /make-po, /pos/:poNumber/pdf
app.use('/', requireSession, v2POsRouter);

// Suppliers: /suppliers, /suppliers/:vendor
app.use('/', requireSession, v2SuppliersRouter);

// Costs: /costs, /variant-costs, /variant-supplier-codes
app.use('/', requireSession, costsRouter);

// Forecast: /lead-times, /stock-settings, /sales
app.use('/', requireSession, forecastRouter);

// Orders: /admin/orders, /admin/order-detail/:id, /create-draft-order
app.use('/', requireSession, v2OrdersRouter);

// Email: /send-invoice/:id, /send-proforma/:id, /send-low-stock-alert
app.use('/', requireSession, emailRouter);

// Claude proxy
app.use('/', requireSession, claudeProxyRouter);

// ── v1 API ROUTES (portal-token auth for backward compat) ──
app.use('/api', requirePortalToken);
app.use('/api/quotes', quotesRouter);
app.use('/api/purchase-orders', posRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/shopify', shopifyRouter);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Nuvio Quoting API listening on :${port}`);
});
