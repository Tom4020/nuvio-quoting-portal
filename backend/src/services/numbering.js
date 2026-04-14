// Simple sequential numbering: Q-YYYYMM-0001, PO-YYYYMM-0001
import { query } from '../db.js';

function yyyymm() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function nextQuoteNumber() {
  const prefix = `Q-${yyyymm()}-`;
  const { rows } = await query(
    `SELECT quote_number FROM quotes WHERE quote_number LIKE $1 ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  const next = rows[0] ? parseInt(rows[0].quote_number.split('-').pop(), 10) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

export async function nextPoNumber() {
  const prefix = `PO-${yyyymm()}-`;
  const { rows } = await query(
    `SELECT po_number FROM purchase_orders WHERE po_number LIKE $1 ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  const next = rows[0] ? parseInt(rows[0].po_number.split('-').pop(), 10) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}
