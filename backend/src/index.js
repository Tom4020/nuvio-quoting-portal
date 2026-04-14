import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { requirePortalToken } from './middleware/auth.js';
import { router as quotesRouter } from './routes/quotes.js';
import { router as posRouter } from './routes/purchaseOrders.js';
import { router as ordersRouter } from './routes/orders.js';
import { router as shopifyRouter } from './routes/shopify.js';

const app = express();

app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev'));
app.use(express.json({ limit: '1mb' }));

const allowed = (process.env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.includes('*') || allowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  allowedHeaders: ['Content-Type', 'x-portal-token'],
  methods: ['GET','POST','PATCH','DELETE','OPTIONS']
}));

// Health check (no auth) — Railway uses this
app.get('/healthz', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Everything under /api requires the shared portal token
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
