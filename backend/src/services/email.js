import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
    // Return null — caller will handle dev mode gracefully
    return null;
  }

  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(smtpPort),
    secure: Number(smtpPort) === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  return transporter;
}

export async function sendOtpEmail(email, code) {
  const t = getTransporter();
  if (!t) throw new Error('SMTP not configured');

  const fromEmail = process.env.FROM_EMAIL || 'noreply@nuvio.com';
  await t.sendMail({
    from: fromEmail,
    to: email,
    subject: `Your Nuvio Portal Code: ${code}`,
    text: `Your one-time code is: ${code}\n\nThis code expires in 10 minutes.`,
    html: `<p>Your one-time code is: <strong>${code}</strong></p><p>This code expires in 10 minutes.</p>`
  });
}

export async function sendInvoiceEmail(email, name, orderId) {
  const t = getTransporter();
  if (!t) throw new Error('SMTP not configured');

  const fromEmail = process.env.FROM_EMAIL || 'noreply@nuvio.com';
  const appUrl = process.env.APP_URL || 'https://nuvio.com';
  const invoiceUrl = `${appUrl}/invoice/${orderId}`;

  await t.sendMail({
    from: fromEmail,
    to: email,
    subject: `Invoice #${orderId}`,
    text: `Hello ${name},\n\nYour invoice is ready. Please visit: ${invoiceUrl}`,
    html: `<p>Hello ${name},</p><p>Your invoice is ready:</p><p><a href="${invoiceUrl}">View Invoice</a></p>`
  });
}

export async function sendProformaEmail(email, name, draftId) {
  const t = getTransporter();
  if (!t) throw new Error('SMTP not configured');

  const fromEmail = process.env.FROM_EMAIL || 'noreply@nuvio.com';
  const appUrl = process.env.APP_URL || 'https://nuvio.com';
  const proformaUrl = `${appUrl}/proforma/${draftId}`;

  await t.sendMail({
    from: fromEmail,
    to: email,
    subject: `Proforma Invoice`,
    text: `Hello ${name},\n\nYour proforma invoice is ready. Please visit: ${proformaUrl}`,
    html: `<p>Hello ${name},</p><p>Your proforma invoice is ready:</p><p><a href="${proformaUrl}">View Proforma</a></p>`
  });
}

// Send a purchase order PDF as an email attachment.
// `to` is the recipient email; `po` and `company` are used to compose the body.
// `pdfBuffer` is the rendered PDF (as a Buffer).
// `audience` is 'supplier' | 'self' — only changes wording.
export async function sendPurchaseOrderEmail({ to, po, company, pdfBuffer, audience = 'supplier' }) {
  const t = getTransporter();
  if (!t) throw new Error('SMTP not configured');

  const fromEmail = process.env.FROM_EMAIL || 'noreply@nuvio.com';
  const companyName = (company && company.name) || process.env.COMPANY_NAME || 'Nuvio';
  const contactName = (company && company.contact) || '';
  const phone = (company && company.phone) || '';
  const email = (company && company.email) || fromEmail;

  const supplierName = po.vendor || 'Supplier';
  const subject = audience === 'self'
    ? `[Copy] Purchase Order ${po.poNumber} — ${supplierName}`
    : `Purchase Order ${po.poNumber} from ${companyName}`;

  const greeting = audience === 'self'
    ? `Hi ${contactName || 'team'},`
    : `Hi ${(po.supplier && po.supplier.contact) || supplierName},`;

  const body = audience === 'self'
    ? `Attached is a copy of purchase order ${po.poNumber} for ${supplierName}.`
    : `Please find attached purchase order ${po.poNumber}.\n\n`
      + `Total: ${po.currency || 'AUD'} ${Number(po.total || 0).toFixed(2)}\n`
      + (po.paymentTerms ? `Payment terms: ${po.paymentTerms}\n` : '')
      + (po.supplierQuote ? `Supplier quote ref: ${po.supplierQuote}\n` : '')
      + `\nLet us know if you have any questions.`;

  const signature = `\n\nThanks,\n${contactName || companyName}\n${companyName}` + (phone ? `\n${phone}` : '') + `\n${email}`;

  await t.sendMail({
    from: fromEmail,
    to,
    subject,
    text: `${greeting}\n\n${body}${signature}`,
    html: `<p>${greeting}</p><p>${body.replace(/\n/g, '<br/>')}</p><p>${signature.trim().replace(/\n/g, '<br/>')}</p>`,
    attachments: [{
      filename: `${po.poNumber}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    }]
  });
}

export async function sendLowStockAlert(items) {
  const t = getTransporter();
  if (!t) throw new Error('SMTP not configured');

  const fromEmail = process.env.FROM_EMAIL || 'noreply@nuvio.com';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@nuvio.com';

  const table = items.map(it =>
    `<tr><td>${it.sku}</td><td>${it.name}</td><td>${it.available}</td><td>${it.threshold}</td></tr>`
  ).join('');

  const html = `
    <p>The following items are below their reorder thresholds:</p>
    <table style="border-collapse:collapse;width:100%;">
      <thead>
        <tr style="background:#f0f0f0;"><th>SKU</th><th>Product</th><th>Available</th><th>Threshold</th></tr>
      </thead>
      <tbody>
        ${table}
      </tbody>
    </table>
  `;

  await t.sendMail({
    from: fromEmail,
    to: adminEmail,
    subject: `Low Stock Alert: ${items.length} items below threshold`,
    html
  });
}
