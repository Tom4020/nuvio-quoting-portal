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
