# Architecture

## Components

| Component | Where it lives | Responsibility |
|-----------|---------------|----------------|
| Shopify theme section `quoting-portal.liquid` | Nuvio's live Shopify theme | Renders the portal UI inside a staff-only Shopify page |
| `assets/quoting-portal.{js,css}` | Theme assets | Client app that calls the API |
| Express API (`backend/`) | Railway | Business logic + data persistence |
| Postgres | Railway plugin | Source of truth for quotes, POs, orders, customers |
| Shopify Admin API | Shopify | Product catalog + draft orders |

## Data model

- **customers** — optionally linked to a Shopify customer by `shopify_id`
- **quotes** + **quote_items** — status flow: `draft → sent → accepted → converted` (or `rejected` / `expired`)
- **suppliers**, **purchase_orders** + **purchase_order_items** — status flow: `draft → sent → partial → received`
- **orders** — internal mirror of Shopify orders with our own fulfilment state (`new → processing → packed → shipped → delivered`)

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/quotes` | list |
| GET | `/api/quotes/:id` | detail + items + customer |
| POST | `/api/quotes` | create (upserts customer) |
| PATCH | `/api/quotes/:id/status` | change status |
| GET | `/api/quotes/:id/pdf` | streams a PDF quote |
| POST | `/api/quotes/:id/convert` | creates a Shopify draft order |
| GET/POST/PATCH | `/api/purchase-orders...` | PO CRUD + status + receive |
| GET/PATCH | `/api/orders...` | Order list + internal status |
| GET | `/api/shopify/products?q=` | Proxy to Shopify product search |

All `/api/*` routes require header `x-portal-token: <PORTAL_TOKEN>`. The Liquid section injects this token from its schema settings (which you set per-theme in the Shopify admin, not in code).

## Auth model

For v1 we rely on two layers:
1. The Shopify page hosting the portal is password-protected (or restricted to logged-in staff via theme logic).
2. Every API call includes a shared `PORTAL_TOKEN`. Rotate by updating the Railway env var and the Shopify section setting.

Upgrade path: when you need per-user accounts and audit trails, swap `requirePortalToken` for a JWT/session middleware and add a `users` table.

## Converting an accepted quote into a real order

1. Sales clicks **Convert to Shopify draft order** on an accepted quote.
2. Backend calls `POST /admin/api/{version}/draft_orders.json` with line items (variant_id when available, else custom line item + price).
3. Shopify returns an `invoice_url` the customer can pay.
4. Once paid, Shopify creates a real order. (Optional next step: add a Shopify webhook handler `/api/shopify/webhooks/orders/create` that inserts into our `orders` table and links it back to `source_quote_id`.)
