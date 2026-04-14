import { Router } from 'express';
import { scryptSync } from 'node:crypto';
import { query } from '../db.js';
import { signJwt } from '../middleware/session.js';
import { sendOtpEmail } from '../services/email.js';

export const router = Router();

function hashPassword(password) {
  const salt = Buffer.alloc(16, 'salt');
  return scryptSync(password, salt, 32).toString('hex');
}

function verifyPassword(password, hash) {
  const derived = scryptSync(password, Buffer.alloc(16, 'salt'), 32).toString('hex');
  return derived === hash;
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /login — verify email & password, send OTP
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (!rows[0]) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = rows[0];
    if (!verifyPassword(password, user.pass_hash)) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Generate OTP (6 digits, 10-min expiry)
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await query(
      'INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, $3)',
      [email, code, expiresAt]
    );

    // Send OTP via email (or log if no SMTP)
    try {
      await sendOtpEmail(email, code);
    } catch (err) {
      console.warn('Failed to send OTP email, logging to console:', err.message);
      console.log(`OTP for ${email}: ${code}`);
    }

    res.json({ ok: true, email });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /verify-otp — verify code, issue JWT
router.post('/verify-otp', async (req, res) => {
  const { email, code } = req.body || {};

  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code required' });
  }

  try {
    // Find latest unused OTP for email
    const { rows } = await query(
      `SELECT * FROM otp_codes WHERE email = $1 AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );

    const otp = rows[0];
    if (!otp) {
      return res.status(401).json({ error: 'No OTP found. Please request a new code.' });
    }

    if (otp.code !== code) {
      return res.status(401).json({ error: 'Invalid code' });
    }

    if (new Date() > new Date(otp.expires_at)) {
      return res.status(401).json({ error: 'Code expired. Please request a new code.' });
    }

    // Mark as used
    await query('UPDATE otp_codes SET used_at = NOW() WHERE id = $1', [otp.id]);

    // Fetch user
    const userRows = await query('SELECT id, email, name, role, commission FROM users WHERE email = $1', [email]);
    if (!userRows.rows[0]) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = userRows.rows[0];
    const token = signJwt(user);

    res.json({
      ok: true,
      token,
      user: { email: user.email, name: user.name, role: user.role, commission: user.commission }
    });
  } catch (err) {
    console.error('OTP verification error:', err);
    res.status(500).json({ error: err.message });
  }
});
