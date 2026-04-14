# Nuvio Quoting Portal

Internal **quoting tool + purchase order + order management system** for Nuvio.

- **Frontend**: Shopify Liquid section (embeds inside a password-protected page on the Nuvio store)
- **Backend**: Node.js / Express + Postgres, deployed to **Railway**
- **Integrations**: Shopify Admin API (product sync, convert accepted quote → Shopify draft order)
- **Outputs**: PDF quote export

---

## Architecture

```
┌───────────────────────────────┐     ┌────────────────────────────┐
│  Shopify storefront (Liquid)  │     │       Railway (Node)       │
│  sections/quoting-portal      │◄───►│  Express API + Postgres    │
│  assets/quoting-portal.js     │ JSON│  /api/quotes /api/pos ...  │
└───────────────┬───────────────┘     └──────────────┬─────────────┘
                │                                    │
                └────────────────────────────────────┤
                           Shopify Admin API         │
                    (products, draft orders, orders) │
                                                     ▼
                                              Shopify Admin
```

The Shopify section renders the UI inside Nuvio's theme so staff can access it while logged into Shopify. All business data (quotes, purchase orders, orders) lives in Postgres on Railway so it is **not** constrained by Shopify's data model.

---

## Quick start (first deploy)

### 1. Push this repo to GitHub

```bash
cd nuvio-quoting-portal
git init
git add .
git commit -m "Initial scaffold of Nuvio quoting portal"
git branch -M main
git remote add origin git@github.com:nuvio/quoting-portal.git
git push -u origin main
```

### 2. Deploy backend to Railway

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → pick `nuvio/quoting-portal`.
2. In the project, set **Root Directory** to `backend/`.
3. Click **+ New** → **Database** → **Add PostgreSQL**.
4. On the backend service → **Variables** → paste the values from `backend/.env.example`. Railway injects `DATABASE_URL` automatically from the Postgres plugin.
5. First deploy runs `npm run migrate && npm start` (see `backend/package.json`).
6. In **Settings → Networking**, click **Generate Domain**. Copy it, e.g. `https://nuvio-quoting.up.railway.app`.

### 3. Create a Shopify custom app (Admin API access)

1. In Nuvio's Shopify Admin → **Settings → Apps and sales channels → Develop apps → Create an app**.
2. Name it `Nuvio Quoting Portal`.
3. **Configure Admin API scopes**: enable `read_products`, `read_product_listings`, `read_customers`, `write_draft_orders`, `read_draft_orders`, `read_orders`.
4. **Install app**, then copy the **Admin API access token**.
5. In Railway → backend service → **Variables**, set:
   - `SHOPIFY_STORE_DOMAIN` = `nuvio.myshopify.com`
   - `SHOPIFY_ADMIN_TOKEN` = the token from step 4
6. Redeploy.

### 4. Add the Liquid section to Nuvio's theme

1. Shopify Admin → **Online Store → Themes → Edit code** on the live theme.
2. Create the following files (copy from `shopify-theme/` in this repo):
   - `sections/quoting-portal.liquid`
   - `assets/quoting-portal.js`
   - `assets/quoting-portal.css`
   - `templates/page.quoting.json`
3. Create a new **Page** in Shopify called `Quoting Portal` with template `page.quoting`.
4. Password-protect the page (or restrict via staff-only logic in `quoting-portal.liquid`).
5. In `sections/quoting-portal.liquid`, set:
   ```liquid
   {% assign api_base = 'https://nuvio-quoting.up.railway.app' %}
   ```
   to match your Railway domain.

### 5. Set CORS on the backend

In Railway, set:
```
ALLOWED_ORIGIN=https://nuvio.com,https://nuvio.myshopify.com
```

### 6. Done

Visit `https://nuvio.com/pages/quoting-portal` and start building quotes.

---

## Local development

```bash
# backend
cd backend
cp .env.example .env     # fill in values
npm install
npm run migrate
npm run dev              # http://localhost:3000
```

For the Shopify section, work in a dev theme via the [Shopify CLI](https://shopify.dev/docs/themes/tools/cli):

```bash
shopify theme dev --store=nuvio.myshopify.com
```

---

## See also

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — data model, API routes, auth model
- [`docs/SETUP.md`](docs/SETUP.md) — detailed setup & troubleshooting
