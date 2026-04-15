import PDFDocument from 'pdfkit';

// Stream a PDF quote to `res`. Keep layout simple and printable.
export function streamQuotePdf(res, { quote, items, customer }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${quote.quote_number}.pdf"`);
  doc.pipe(res);

  const company = {
    name: process.env.COMPANY_NAME || 'Nuvio',
    address: process.env.COMPANY_ADDRESS || '',
    email: process.env.COMPANY_EMAIL || ''
  };

  // Header
  doc.fontSize(20).text(company.name, { continued: false });
  doc.fontSize(9).fillColor('#555')
    .text(company.address)
    .text(company.email);
  doc.moveDown();

  doc.fillColor('#000').fontSize(18).text('QUOTE', { align: 'right' });
  doc.fontSize(10).fillColor('#555')
    .text(`Quote #: ${quote.quote_number}`, { align: 'right' })
    .text(`Date: ${new Date(quote.created_at).toLocaleDateString('en-AU')}`, { align: 'right' });
  if (quote.valid_until) {
    doc.text(`Valid until: ${new Date(quote.valid_until).toLocaleDateString('en-AU')}`, { align: 'right' });
  }
  doc.moveDown(1.5);

  // Bill to
  if (customer) {
    doc.fillColor('#000').fontSize(11).text('Bill to', { underline: true });
    doc.fontSize(10)
      .text(customer.company || customer.name || '')
      .text(customer.name || '')
      .text(customer.email || '');
    doc.moveDown();
  }

  // Items table
  const tableTop = doc.y + 10;
  const col = { desc: 50, qty: 330, unit: 380, total: 470 };

  doc.fontSize(10).fillColor('#000').text('Description', col.desc, tableTop);
  doc.text('Qty', col.qty, tableTop, { width: 40, align: 'right' });
  doc.text('Unit', col.unit, tableTop, { width: 70, align: 'right' });
  doc.text('Line total', col.total, tableTop, { width: 80, align: 'right' });
  doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#ccc').stroke();

  let y = tableTop + 22;
  for (const it of items) {
    doc.fillColor('#000').fontSize(10).text(it.title, col.desc, y, { width: 270 });
    if (it.description) {
      doc.fontSize(8).fillColor('#666').text(it.description, col.desc, doc.y, { width: 270 });
      doc.fontSize(10).fillColor('#000');
    }
    const rowY = y;
    doc.text(String(it.quantity), col.qty, rowY, { width: 40, align: 'right' });
    doc.text(fmt(it.unit_price, quote.currency), col.unit, rowY, { width: 70, align: 'right' });
    doc.text(fmt(it.line_total, quote.currency), col.total, rowY, { width: 80, align: 'right' });
    y = Math.max(doc.y, rowY + 18) + 6;
    if (y > 720) { doc.addPage(); y = 60; }
  }

  doc.moveTo(50, y).lineTo(550, y).strokeColor('#ccc').stroke();
  y += 10;

  // Totals
  const totalsX = 380;
  doc.fontSize(10).fillColor('#000');
  doc.text('Subtotal', totalsX, y, { width: 90, align: 'right' });
  doc.text(fmt(quote.subtotal, quote.currency), col.total, y, { width: 80, align: 'right' });
  y += 16;

  if (Number(quote.discount) > 0) {
    doc.text('Discount', totalsX, y, { width: 90, align: 'right' });
    doc.text(`-${fmt(quote.discount, quote.currency)}`, col.total, y, { width: 80, align: 'right' });
    y += 16;
  }

  doc.text(`Tax (${(Number(quote.tax_rate) * 100).toFixed(0)}%)`, totalsX, y, { width: 90, align: 'right' });
  doc.text(fmt(quote.tax, quote.currency), col.total, y, { width: 80, align: 'right' });
  y += 18;

  doc.fontSize(12).text('Total', totalsX, y, { width: 90, align: 'right' });
  doc.text(fmt(quote.total, quote.currency), col.total, y, { width: 80, align: 'right' });

  if (quote.notes) {
    doc.moveDown(3);
    doc.fontSize(10).fillColor('#000').text('Notes', { underline: true });
    doc.fontSize(9).fillColor('#333').text(quote.notes);
  }

  doc.end();
}

function fmt(n, currency = 'AUD') {
  const num = Number(n || 0);
  return `${currency} ${num.toFixed(2)}`;
}

// Fetch a remote image as a Buffer for embedding into the PDF
async function fetchImageBuffer(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    // pdfkit supports PNG and JPEG only
    if (!ct.includes('image/png') && !ct.includes('image/jpeg') && !ct.includes('image/jpg')) {
      // Try anyway — many CDNs don't set correct content-type
    }
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

// Stream a PDF purchase order to `res`.
// Inputs: po = { poNumber, quoteNumber, date, vendor, supplier, paymentTerms, items, subtotal, gst, total, notes, currency }
// supplier = { contact, email, phone, address, paymentTerms, notes }
// items = [{ sku, description, quantity, buy_ex, line_total, image_url }]
// company (optional, from kv_store company_details) = { name, tradingName, contact, email, phone, address, abn, website }
export async function streamPurchaseOrderPdf(res, { po, company: companyIn } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const currency = po.currency || 'AUD';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${po.poNumber}.pdf"`);
  doc.pipe(res);

  // Pre-fetch all item images in parallel so rendering stays synchronous
  const images = await Promise.all(
    (po.items || []).map(it => fetchImageBuffer(it.image_url))
  );

  // kv_store company details take precedence; fall back to env vars
  const c = companyIn || {};
  const company = {
    name: c.name || process.env.COMPANY_NAME || 'Nuvio',
    address: c.address || process.env.COMPANY_ADDRESS || '',
    email: c.email || process.env.COMPANY_EMAIL || '',
    phone: c.phone || process.env.COMPANY_PHONE || '',
    abn: c.abn || process.env.COMPANY_ABN || '',
    contact: c.contact || '',
    website: c.website || ''
  };

  // Header: company on left, PO title+number on right
  doc.fontSize(20).fillColor('#000').text(company.name, 50, 50);
  doc.fontSize(9).fillColor('#555');
  if (company.address) doc.text(company.address, 50, doc.y);
  if (company.email) doc.text(company.email, 50, doc.y);
  if (company.phone) doc.text(company.phone, 50, doc.y);
  if (company.website) doc.text(company.website, 50, doc.y);
  if (company.abn) doc.text(`ABN: ${company.abn}`, 50, doc.y);

  doc.fontSize(18).fillColor('#000').text('PURCHASE ORDER', 300, 50, { align: 'right', width: 245 });
  doc.fontSize(10).fillColor('#555')
    .text(`PO #: ${po.poNumber}`, 300, 75, { align: 'right', width: 245 })
    .text(`Date: ${new Date(po.date || Date.now()).toLocaleDateString('en-AU')}`, 300, doc.y, { align: 'right', width: 245 });
  if (po.quoteNumber) {
    doc.text(`Quote ref: ${po.quoteNumber}`, 300, doc.y, { align: 'right', width: 245 });
  }
  const terms = po.paymentTerms || (po.supplier && po.supplier.paymentTerms) || '';
  if (terms) {
    doc.text(`Payment terms: ${terms}`, 300, doc.y, { align: 'right', width: 245 });
  }

  // Move below header
  doc.y = Math.max(doc.y, 140);
  doc.moveDown(0.5);

  // Supplier block (Bill to equivalent = "Supplier")
  const supplierTop = doc.y;
  doc.fillColor('#000').fontSize(11).text('Supplier', 50, supplierTop, { underline: true });
  doc.fontSize(10).fillColor('#000');
  doc.text(po.vendor || '', 50, doc.y);
  const s = po.supplier || {};
  if (s.contact) doc.text(s.contact, 50, doc.y);
  if (s.email) doc.text(s.email, 50, doc.y);
  if (s.phone) doc.text(s.phone, 50, doc.y);
  if (s.address) doc.text(s.address, 50, doc.y, { width: 250 });

  // Ship to on the right
  doc.fontSize(11).text('Ship to', 320, supplierTop, { underline: true, width: 225 });
  doc.fontSize(10).fillColor('#000');
  doc.text(company.name, 320, doc.y, { width: 225 });
  if (company.address) doc.text(company.address, 320, doc.y, { width: 225 });
  if (company.contact) doc.text('Attn: ' + company.contact, 320, doc.y, { width: 225 });

  doc.moveDown(2);

  // Items table — now includes a product image column
  const tableTop = Math.max(doc.y, 260);
  const col = { img: 50, sku: 110, desc: 175, qty: 355, unit: 400, total: 485 };

  doc.fontSize(10).fillColor('#000').text('Image', col.img, tableTop, { width: 55 });
  doc.text('SKU', col.sku, tableTop, { width: 60 });
  doc.text('Description', col.desc, tableTop, { width: 175 });
  doc.text('Qty', col.qty, tableTop, { width: 40, align: 'right' });
  doc.text('Unit (ex)', col.unit, tableTop, { width: 80, align: 'right' });
  doc.text('Line total', col.total, tableTop, { width: 65, align: 'right' });
  doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#ccc').stroke();

  let y = tableTop + 22;
  const rowItems = po.items || [];
  for (let i = 0; i < rowItems.length; i++) {
    const it = rowItems[i];
    const img = images[i];
    const rowY = y;
    const rowMinH = 50; // give room for the image

    doc.fontSize(10).fillColor('#000');
    if (img) {
      try {
        doc.image(img, col.img, rowY, { fit: [50, 50] });
      } catch {
        // bad image payload — skip silently
      }
    }
    doc.text(it.sku || '', col.sku, rowY, { width: 60 });
    doc.text(it.description || it.title || '', col.desc, rowY, { width: 175 });
    doc.text(String(it.quantity || 0), col.qty, rowY, { width: 40, align: 'right' });
    doc.text(fmt(it.buy_ex, currency), col.unit, rowY, { width: 80, align: 'right' });
    doc.text(fmt(it.line_total, currency), col.total, rowY, { width: 65, align: 'right' });

    y = Math.max(doc.y, rowY + rowMinH) + 6;
    if (y > 720) { doc.addPage(); y = 60; }
  }

  doc.moveTo(50, y).lineTo(550, y).strokeColor('#ccc').stroke();
  y += 10;

  // Totals (ex GST on PO since supplier invoices typically itemise GST separately)
  const totalsX = 380;
  doc.fontSize(10).fillColor('#000');
  doc.text('Subtotal (ex GST)', totalsX, y, { width: 110, align: 'right' });
  doc.text(fmt(po.subtotal, currency), col.total, y, { width: 65, align: 'right' });
  y += 16;

  if (po.gst != null) {
    doc.text('GST (10%)', totalsX, y, { width: 110, align: 'right' });
    doc.text(fmt(po.gst, currency), col.total, y, { width: 65, align: 'right' });
    y += 16;
  }

  doc.fontSize(12).text('Total', totalsX, y, { width: 110, align: 'right' });
  doc.text(fmt(po.total, currency), col.total, y, { width: 65, align: 'right' });
  y += 24;

  // Payment terms block (below totals, left-aligned)
  if (terms) {
    doc.fontSize(10).fillColor('#000').text('Payment terms', 50, y, { underline: true });
    doc.fontSize(10).fillColor('#333').text(terms, 50, doc.y, { width: 300 });
  }

  if (po.notes) {
    doc.moveDown(2);
    doc.fontSize(10).fillColor('#000').text('Notes', 50, doc.y, { underline: true });
    doc.fontSize(9).fillColor('#333').text(po.notes, 50, doc.y, { width: 495 });
  }

  doc.end();
}
