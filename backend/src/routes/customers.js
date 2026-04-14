import { Router } from 'express';
import { requireSession } from '../middleware/session.js';

export const router = Router();

// GET /customers?q=... — search Shopify customers
router.get('/', requireSession, async (req, res) => {
  const q = req.query.q || '';
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2024-10';

  if (!token || !domain) {
    return res.status(500).json({ error: 'Shopify not configured' });
  }

  try {
    const query = q ? `query: "${q}"` : '';
    const gql = {
      query: `query Search($q: String, $n: Int!) {
        customers(first: $n, query: $q) {
          edges { node {
            id
            firstName
            lastName
            email
            phone
            defaultAddress {
              address1
              address2
              city
              provinceCode
              zip
              country
            }
          } }
        }
      }`,
      variables: { q: q || null, n: 25 }
    };

    const res2 = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(gql)
    });

    const data = await res2.json();
    if (data.errors) {
      throw new Error(data.errors[0].message);
    }

    const customers = data.data.customers.edges.map(({ node }) => ({
      id: node.id,
      name: `${node.firstName || ''} ${node.lastName || ''}`.trim(),
      email: node.email,
      phone: node.phone,
      address: node.defaultAddress ? {
        line1: node.defaultAddress.address1,
        line2: node.defaultAddress.address2,
        city: node.defaultAddress.city,
        state: node.defaultAddress.provinceCode,
        zip: node.defaultAddress.zip,
        country: node.defaultAddress.country
      } : null
    }));

    res.json(customers);
  } catch (err) {
    console.error('Customer search error:', err);
    res.status(500).json({ error: err.message });
  }
});
