// Simple shared-secret auth. The Liquid section sends PORTAL_TOKEN in the
// `x-portal-token` header. Good enough for an internal staff-only tool that
// sits behind a password-protected Shopify page. Upgrade to per-user JWT
// later if you need individual accounts.

export function requirePortalToken(req, res, next) {
  const token = req.get('x-portal-token');
  if (!process.env.PORTAL_TOKEN) {
    return res.status(500).json({ error: 'PORTAL_TOKEN not configured on server' });
  }
  if (token !== process.env.PORTAL_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
