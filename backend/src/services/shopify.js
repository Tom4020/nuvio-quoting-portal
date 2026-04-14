// Thin Shopify Admin API client. Uses fetch (Node 20+).
// Scopes required: read_products, read_customers, write_draft_orders, read_orders

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

function baseUrl() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error('SHOPIFY_STORE_DOMAIN not set');
  return `https://${domain}/admin/api/${API_VERSION}`;
}

async function shopify(path, { method = 'GET', body } = {}) {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) throw new Error('SHOPIFY_ADMIN_TOKEN not set');

  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    const err = new Error(`Shopify ${method} ${path} → ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// Search products. Supports ?q= query string (title) and pagination via page_info later.
export async function searchProducts({ q = '', limit = 25 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (q) params.set('title', q);
  const data = await shopify(`/products.json?${params.toString()}`);
  // Flatten to variants so the quote builder can pick a specific variant
  const variants = [];
  for (const p of data.products || []) {
    for (const v of p.variants || []) {
      variants.push({
        product_id: p.id,
        variant_id: v.id,
        title: p.title + (v.title && v.title !== 'Default Title' ? ` — ${v.title}` : ''),
        sku: v.sku,
        price: Number(v.price || 0),
        image: p.image?.src || null
      });
    }
  }
  return variants;
}

// Convert a Nuvio quote into a Shopify draft order. Returns { id, invoice_url }.
export async function createDraftOrderFromQuote(quote, items, customer) {
  const line_items = items.map(it => (
    it.shopify_variant_id
      ? { variant_id: Number(it.shopify_variant_id), quantity: it.quantity, price: Number(it.unit_price).toFixed(2) }
      : { title: it.title, quantity: it.quantity, price: Number(it.unit_price).toFixed(2) }
  ));

  const draft_order = {
    line_items,
    note: `Nuvio quote ${quote.quote_number}${quote.notes ? ' — ' + quote.notes : ''}`,
    tags: `quoting-portal,quote-${quote.quote_number}`,
    currency: quote.currency || 'AUD',
    use_customer_default_address: true
  };

  if (customer?.shopify_id) {
    draft_order.customer = { id: Number(customer.shopify_id) };
  } else if (customer?.email) {
    draft_order.email = customer.email;
  }

  if (Number(quote.discount) > 0) {
    draft_order.applied_discount = {
      description: 'Quote discount',
      value_type: 'fixed_amount',
      value: Number(quote.discount).toFixed(2),
      amount: Number(quote.discount).toFixed(2),
      title: 'Discount'
    };
  }

  const data = await shopify('/draft_orders.json', { method: 'POST', body: { draft_order } });
  return data.draft_order;
}

export async function getOrder(shopifyOrderId) {
  const data = await shopify(`/orders/${shopifyOrderId}.json`);
  return data.order;
}
