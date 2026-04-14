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
