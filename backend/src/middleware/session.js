import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// Decode & verify JWT from Authorization header, or accept legacy portal token
export function requireSession(req, res, next) {
  const authHeader = req.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  // Backward compat: accept legacy x-portal-token as admin
  const portalToken = req.get('x-portal-token');
  if (portalToken && portalToken === process.env.PORTAL_TOKEN) {
    req.user = { email: 'system@nuvio.com.au', name: 'System', role: 'admin' };
    return next();
  }

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Check that user is admin
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Sign a JWT for a user
export function signJwt(user) {
  return jwt.sign(
    { email: user.email, name: user.name, role: user.role, commission: user.commission },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}
