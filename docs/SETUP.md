# Detailed setup

## 1. Generate a portal token

```bash
openssl rand -hex 32
```

Save this value — you will paste it into **both** Railway (as `PORTAL_TOKEN`) and the Shopify section setting (`portal_token`).

## 2. GitHub

```bash
cd nuvio-quoting-portal
git init
git add .
git commit -m "Initial scaffold"
git branch -M main
git remote add origin git@github.com:nuvio/quoting-portal.git
git push -u origin main
```

## 3. Railway — backend

1. [railway.app](https://railway.app) → **New project** → **Deploy from GitHub repo**.
2. Pick the repo → pick `main` branch.
3. In the service → **Settings** → **Root Directory** = `backend`.
4. **+ New** → **Database** → **PostgreSQL**. This exposes `DATABASE_URL` automatically.
5. Service → **Variables** tab, add:
   - `NODE_ENV=production`
   - `PORTAL_TOKEN=` *(the hex string from step 1)*
   - `SHOPIFY_STORE_DOMAIN=nuvio.myshopify.com`
   - `SHOPIFY_ADMIN_TOKEN=` *(filled in step 4 below)*
   - `ALLOWED_ORIGIN=https://nuvio.com,https://nuvio.myshopify.com`
   - `COMPANY_NAME=Nuvio`
   - `COMPANY_ADDRESS=...`
   - `COMPANY_EMAIL=sales@nuvio.com.au`
6. Settings → **Networking** → **Generate Domain**.
7. Trigger a redeploy. Check logs — you should see `Nuvio Quoting API listening on :PORT`.
8. Sanity check: `curl https://<your-domain>/healthz` should return `{ "ok": true, ... }`.

## 4. Shopify — custom app for Admin API

1. Shopify admin → **Settings → Apps and sales channels → Develop apps** → **Allow custom app development** (if not already).
2. **Create an app** → name it `Nuvio Quoting Portal`.
3. **Configuration → Admin API integration → Configure**. Enable:
   - `read_products`
   - `read_product_listings`
   - `read_customers`
   - `write_draft_orders`
   - `read_draft_orders`
   - `read_orders`
4. Save → **Install app** → reveal the **Admin API access token** (starts with `shpat_`). Copy it.
5. Paste into Railway → `SHOPIFY_ADMIN_TOKEN`. Redeploy.

## 5. Shopify — add the theme section

In the Shopify admin → **Online Store → Themes → ⋯ → Edit code** on the live theme:

1. Create `sections/quoting-portal.liquid` — paste contents from `shopify-theme/sections/quoting-portal.liquid`.
2. Create `assets/quoting-portal.css` — paste contents from `shopify-theme/assets/quoting-portal.css`.
3. Create `assets/quoting-portal.js` — paste contents from `shopify-theme/assets/quoting-portal.js`.
4. Create `templates/page.quoting.json` — paste contents from `shopify-theme/templates/page.quoting.json` **and** set:
   - `api_base` → your Railway URL (no trailing slash)
   - `portal_token` → the same hex string as step 1

## 6. Create the staff page

1. Shopify admin → **Online Store → Pages → Add page**.
2. Title: `Quoting Portal`. Template suffix: `quoting`.
3. Save. Visit `https://nuvio.com/pages/quoting-portal`.

**Restrict access**: enable the store's password protection (Online Store → Preferences → Password page) while staff-only, OR gate the page in the section:

```liquid
{% unless customer and customer.tags contains 'staff' %}
  <p>This page is staff-only.</p>
{% else %}
  … portal markup …
{% endunless %}
```

## 7. Smoke test

1. Open the page — the Quotes panel should load (empty).
2. Click **+ New quote** → type a customer name → search for a Shopify product → save.
3. Click the quote row → **Download PDF** → the generated PDF should open.
4. Click **Convert to Shopify draft order** → check Shopify admin → **Orders → Drafts**.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `401 Unauthorized` in browser console | `portal_token` section setting doesn't match `PORTAL_TOKEN` env var |
| `CORS: ...not allowed` | Add your storefront origin (including `https://`) to `ALLOWED_ORIGIN` |
| `SHOPIFY_ADMIN_TOKEN not set` | Set it in Railway and redeploy |
| Product search returns `502` | Token wrong/scopes missing; re-install app with required scopes |
| `DATABASE_URL is not set` on boot | Attach the Postgres plugin and redeploy |
