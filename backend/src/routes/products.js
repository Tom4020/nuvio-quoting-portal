\import { Router } from 'express';
import { requireAdmin } from '../middleware/session.js';

export const router = Router();

const LOCATION_ID = process.env.SHOPIFY_LOCATION_ID || '1';

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

async function shopifyGql(gql) {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2024-10';

  if (!token || !domain) throw new Error('Shopify not configured');

  const res = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(gql)
  });

  const data = await res.json();
  if (!res.ok || data.errors) {
    const err = new Error(`Shopify GraphQL failed (${res.status})`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// GET /products — list products with variants and costs (paginated to pull everything)
router.get('/products', async (req, res) => {
  try {
    const allProducts = [];
    let cursor = null;
    let hasNext = true;

    while (hasNext) {
      const gql = {
        query: `query($cursor: String) {
          products(first: 250, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges { node {
              id
              title
              handle
              vendor
              status
              featuredImage { url }
              variants(first: 100) {
                edges { node {
                  id
                  title
                  sku
                  price
                  inventoryItem { id }
                } }
              }
            } }
          }
        }`,
        variables: { cursor }
      };

      const data = await shopifyGql(gql);
      const page = data.data.products;

      for (const { node: p } of page.edges) {
        const numericProductId = Number(String(p.id).split('/').pop());
        allProducts.push({
          id: numericProductId,
          productTitle: p.title,
          title: p.title,
          handle: p.handle,
          vendor: p.vendor,
          status: p.status,
          image: p.featuredImage?.url || '',
          variants: p.variants.edges.map(({ node: v }) => ({
            id: Number(String(v.id).split('/').pop()),
            title: v.title,
            sku: v.sku,
            price: Number(v.price),
            inventory_item_id: v.inventoryItem?.id
          }))
        });
      }

      hasNext = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
    }

    res.json({ products: allProducts });
  } catch (err) {
    console.error('Products error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /inventory — list inventory levels across locations
router.get('/inventory', async (req, res) => {
  try {
    const gql = {
      query: `query {
        inventoryItems(first: 250) {
          edges { node {
            id
            sku
            inventoryLevels(first: 5) {
              edges { node {
                id
                quantity
                location { id }
              } }
            }
          } }
        }
      }`
    };

    const data = await shopifyGql(gql);
    const available = {};
    const variantToInvItem = {};

    data.data.inventoryItems.edges.forEach(({ node: invItem }) => {
      const gid = invItem.id;
      const numId = Number(String(gid).split('/').pop());

      invItem.inventoryLevels.edges.forEach(({ node: level }) => {
        // Use quantity from location matching SHOPIFY_LOCATION_ID or first
        const locId = level.location.id;
        if (locId.includes(LOCATION_ID)) {
          available[numId] = level.quantity;
          variantToInvItem[numId] = invItem.id;
        }
      });
    });

    res.json({ available, variantToInvItem });
  } catch (err) {
    console.error('Inventory error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /manage-products — full product list for management UI
router.get('/manage-products', async (req, res) => {
  const status = req.query.status || 'all';
  const search = req.query.search || '';

  try {
    const query_str = search ? `title:*${search}*` : '';
    const gql = {
      query: `query Search($q: String, $n: Int!) {
        products(first: $n, query: $q) {
          edges { node {
            id
            title
            vendor
            productType
            tags
            status
            bodyHtml
            featuredImage { id url }
            images(first: 100) {
              edges { node { id src } }
            }
            variants(first: 100) {
              edges { node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                weight
                weightUnit
                inventory: inventoryQuantity
                inventoryItem { id }
              } }
            }
          } }
        }
      }`,
      variables: { q: query_str || null, n: 250 }
    };

    const data = await shopifyGql(gql);
    const products = data.data.products.edges.map(({ node: p }) => ({
      id: p.id,
      title: p.title,
      vendor: p.vendor,
      product_type: p.productType,
      tags: p.tags,
      status: p.status,
      body_html: p.bodyHtml,
      images: p.images.edges.map(({ node: img }) => ({
        id: img.id,
        src: img.src
      })),
      variants: p.variants.edges.map(({ node: v }) => ({
        id: v.id,
        title: v.title,
        sku: v.sku,
        barcode: v.barcode,
        price: Number(v.price),
        compare_at_price: v.compareAtPrice ? Number(v.compareAtPrice) : null,
        weight: Number(v.weight),
        weight_unit: v.weightUnit,
        inventory_quantity: v.inventory,
        inventory_item_id: v.inventoryItem?.id
      }))
    }));

    res.json(products);
  } catch (err) {
    console.error('Manage products error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /manage-products — create product
router.post('/manage-products', requireAdmin, async (req, res) => {
  const { title, body_html, vendor, product_type, tags, status, variants } = req.body;

  if (!title) return res.status(400).json({ error: 'Title required' });

  try {
    const product = {
      title,
      body_html: body_html || '',
      vendor: vendor || '',
      product_type: product_type || '',
      tags: tags || '',
      status: status || 'draft',
      variants: (variants || []).map(v => ({
        price: String(v.price),
        compare_at_price: v.compare_at_price ? String(v.compare_at_price) : null,
        sku: v.sku || '',
        barcode: v.barcode || '',
        weight: v.weight || 0,
        weight_unit: v.weight_unit || 'kg',
        inventory_management: v.inventory_management || 'shopify'
      }))
    };

    const data = await shopifyRest('POST', '/products.json', { product });
    const newProduct = data.product;

    // If variants have inventory, adjust levels
    for (let i = 0; i < (variants || []).length; i++) {
      const v = variants[i];
      if (v.inventory_quantity && v.inventory_quantity > 0 && newProduct.variants[i]) {
        try {
          await shopifyRest('POST', '/inventory_levels/adjust.json', {
            location_id: LOCATION_ID,
            inventory_item_id: newProduct.variants[i].inventory_item_id,
            available_adjustment: v.inventory_quantity
          });
        } catch (e) {
          console.warn('Inventory adjust failed:', e.message);
        }
      }
    }

    res.status(201).json({
      id: newProduct.id,
      title: newProduct.title,
      variants: newProduct.variants
    });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PUT /manage-products/:id — update product
router.put('/manage-products/:id', requireAdmin, async (req, res) => {
  const { title, body_html, vendor, product_type, tags, status } = req.body;

  try {
    const product = {
      title: title || '',
      body_html: body_html || '',
      vendor: vendor || '',
      product_type: product_type || '',
      tags: tags || '',
      status: status || 'draft'
    };

    const data = await shopifyRest('PUT', `/products/${req.params.id}.json`, { product });
    res.json(data.product);
  } catch (err) {
    console.error('Update product error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// DELETE /manage-products/:id — delete product
router.delete('/manage-products/:id', requireAdmin, async (req, res) => {
  try {
    await shopifyRest('DELETE', `/products/${req.params.id}.json`, null);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PUT /manage-variants/:id — update variant
router.put('/manage-variants/:id', requireAdmin, async (req, res) => {
  const { price, compare_at_price, sku, barcode, weight, weight_unit } = req.body;

  try {
    const variant = {
      price: price ? String(price) : undefined,
      compare_at_price: compare_at_price ? String(compare_at_price) : null,
      sku: sku || '',
      barcode: barcode || '',
      weight: weight || 0,
      weight_unit: weight_unit || 'kg'
    };

    const data = await shopifyRest('PUT', `/variants/${req.params.id}.json`, { variant });
    res.json(data.variant);
  } catch (err) {
    console.error('Update variant error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /manage-products/:id/images — upload image
router.post('/manage-products/:id/images', requireAdmin, async (req, res) => {
  const { attachment, filename } = req.body;

  if (!attachment || !filename) {
    return res.status(400).json({ error: 'Attachment and filename required' });
  }

  try {
    const data = await shopifyRest('POST', `/products/${req.params.id}/images.json`, {
      image: { attachment, filename }
    });
    res.json(data.image);
  } catch (err) {
    console.error('Upload image error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// DELETE /manage-products/:id/images/:imageId — delete image
router.delete('/manage-products/:id/images/:imageId', requireAdmin, async (req, res) => {
  try {
    await shopifyRest('DELETE', `/products/${req.params.id}/images/${req.params.imageId}.json`, null);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete image error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});
