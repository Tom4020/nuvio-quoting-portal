import { Router } from 'express';
import { query } from '../db.js';
import { requireSession } from '../middleware/session.js';

export const router = Router();

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

// Helper: extract numeric ID from Shopify GID
function gidToNum(gid) {
  return Number(String(gid).split('/').pop());
}

// GET /costs — return costs blob (auto-seed from Shopify if empty)
router.get('/costs', async (req, res) => {
  try {
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['costs']);
    let data = rows[0]?.value || {};

    // If empty, auto-pull from Shopify on first load
    if (!data || Object.keys(data).length === 0) {
      try {
        const pulled = await pullCostsFromShopify();
        if (Object.keys(pulled).length > 0) {
          await query(
            `INSERT INTO kv_store (key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET
               value = EXCLUDED.value,
               updated_at = NOW()`,
            ['costs', JSON.stringify(pulled)]
          );
          data = pulled;
        }
      } catch (e) {
        console.warn('Auto-seed costs from Shopify failed:', e.message);
      }
    }

    res.json(data);
  } catch (err) {
    console.error('Error fetching costs:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /costs/import-from-shopify — force a re-pull from Shopify (overwrites local)
router.post('/costs/import-from-shopify', async (req, res) => {
  try {
    const pulled = await pullCostsFromShopify();
    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['costs', JSON.stringify(pulled)]
    );

    // Also pull supplier codes
    const codes = await pullSupplierCodesFromShopify();
    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['variant_supplier_codes', JSON.stringify(codes)]
    );

    res.json({
      ok: true,
      variants_with_cost: Object.keys(pulled).length,
      variants_with_supplier_code: Object.keys(codes).length,
      costs: pulled,
      supplier_codes: codes
    });
  } catch (err) {
    console.error('Error importing costs from Shopify:', err);
    res.status(500).json({ error: err.message, detail: err.body });
  }
});

// Pull all variant costs from Shopify.
// Prefers nuvio.cost_aud metafield; falls back to inventoryItem.unitCost.
async function pullCostsFromShopify() {
  const result = {};
  let cursor = null;
  let hasNext = true;

  while (hasNext) {
    const gql = {
      query: `query($cursor: String) {
        productVariants(first: 250, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          edges { node {
            id
            sku
            inventoryItem { unitCost { amount } }
            metafield(namespace: "nuvio", key: "cost_aud") { value }
          } }
        }
      }`,
      variables: { cursor }
    };

    const data = await shopifyGql(gql);
    const page = data.data.productVariants;

    for (const { node: v } of page.edges) {
      const numId = gidToNum(v.id);
      const metaCost = v.metafield?.value ? Number(v.metafield.value) : null;
      const unitCost = v.inventoryItem?.unitCost?.amount
        ? Number(v.inventoryItem.unitCost.amount)
        : null;
      const cost = (metaCost != null && !isNaN(metaCost)) ? metaCost
                 : (unitCost != null && !isNaN(unitCost)) ? unitCost
                 : null;

      if (cost != null && cost > 0) {
        result[String(numId)] = { price: cost };
      }
    }

    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return result;
}

async function pullSupplierCodesFromShopify() {
  const result = {};
  let cursor = null;
  let hasNext = true;

  while (hasNext) {
    const gql = {
      query: `query($cursor: String) {
        productVariants(first: 250, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          edges { node {
            id
            metafield(namespace: "nuvio", key: "supplier_code") { value }
          } }
        }
      }`,
      variables: { cursor }
    };

    const data = await shopifyGql(gql);
    const page = data.data.productVariants;

    for (const { node: v } of page.edges) {
      const numId = gidToNum(v.id);
      const code = v.metafield?.value;
      if (code) result[String(numId)] = code;
    }

    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return result;
}

// POST /costs — upsert costs blob and sync to Shopify metafields
router.post('/costs', async (req, res) => {
  const costs = req.body || {};

  try {
    // Save to kv_store
    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['costs', JSON.stringify(costs)]
    );

    // Sync to Shopify metafields (non-blocking)
    syncCostsToShopify(costs).catch(err => {
      console.warn('Failed to sync costs to Shopify:', err.message);
    });

    res.json(costs);
  } catch (err) {
    console.error('Error saving costs:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /variant-costs — return variant costs blob
router.get('/variant-costs', async (req, res) => {
  try {
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['variant_costs']);
    const data = rows[0]?.value || {};
    res.json(data);
  } catch (err) {
    console.error('Error fetching variant costs:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /variant-costs — upsert variant costs blob
router.post('/variant-costs', async (req, res) => {
  const costs = req.body || {};

  try {
    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['variant_costs', JSON.stringify(costs)]
    );
    res.json(costs);
  } catch (err) {
    console.error('Error saving variant costs:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /variant-supplier-codes — upsert supplier codes and sync to Shopify
router.post('/variant-supplier-codes', async (req, res) => {
  const codes = req.body || {};

  try {
    // Get existing codes
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', ['variant_supplier_codes']);
    const existing = rows[0]?.value || {};

    // Merge and save
    const merged = { ...existing, ...codes };
    await query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      ['variant_supplier_codes', JSON.stringify(merged)]
    );

    // Sync to Shopify (non-blocking)
    syncSupplierCodesToShopify(codes).catch(err => {
      console.warn('Failed to sync supplier codes to Shopify:', err.message);
    });

    res.json(merged);
  } catch (err) {
    console.error('Error saving supplier codes:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper: sync costs to Shopify metafields
async function syncCostsToShopify(costs) {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return;

  for (const [vidStr, costData] of Object.entries(costs)) {
    if (vidStr === '__calc') continue; // Skip calc data
    const vid = vidStr;
    const cost = costData.price || costData;

    // Skip non-numeric costs
    if (typeof cost !== 'number') continue;

    try {
      const gql = {
        query: `mutation SetMetafield($input: MetafieldsSetInput!) {
          metafieldsSet(input: $input) { metafields { id } errors { field message } }
        }`,
        variables: {
          input: {
            metafields: [{
              namespace: 'nuvio',
              key: 'cost_aud',
              value: String(cost),
              valueType: 'string',
              ownerId: `gid://shopify/ProductVariant/${vid}`
            }]
          }
        }
      };

      await shopifyGql(gql);
    } catch (err) {
      console.warn(`Failed to set cost for variant ${vid}:`, err.message);
    }
  }
}

// Helper: sync supplier codes to Shopify metafields
async function syncSupplierCodesToShopify(codes) {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return;

  for (const [vid, code] of Object.entries(codes)) {
    try {
      const gql = {
        query: `mutation SetMetafield($input: MetafieldsSetInput!) {
          metafieldsSet(input: $input) { metafields { id } errors { field message } }
        }`,
        variables: {
          input: {
            metafields: [{
              namespace: 'nuvio',
              key: 'supplier_code',
              value: String(code),
              valueType: 'string',
              ownerId: `gid://shopify/ProductVariant/${vid}`
            }]
          }
        }
      };

      await shopifyGql(gql);
    } catch (err) {
      console.warn(`Failed to set supplier code for variant ${vid}:`, err.message);
    }
  }
}
