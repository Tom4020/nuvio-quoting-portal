import { Router } from 'express';
import { scryptSync } from 'node:crypto';
import { query } from '../db.js';
import { requireSession, requireAdmin } from '../middleware/session.js';

export const router = Router();

function hashPassword(password) {
  const salt = Buffer.alloc(16, 'salt');
  return scryptSync(password, salt, 32).toString('hex');
}

// GET /users — list all users (any session)
router.get('/', requireSession, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, email, name, role, commission FROM users ORDER BY email'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /users — upsert array of users (admin only)
router.post('/', requireSession, requireAdmin, async (req, res) => {
  const users = Array.isArray(req.body) ? req.body : [];

  if (!users.length) {
    return res.status(400).json({ error: 'Users array required' });
  }

  try {
    // Get current user email to prevent lockout
    const currentEmail = req.user.email;

    // Collect emails from posted array
    const postedEmails = new Set(users.map(u => u.email));

    // Delete any user NOT in posted array EXCEPT current user
    const { rows: allUsers } = await query('SELECT email FROM users');
    for (const existing of allUsers) {
      if (!postedEmails.has(existing.email) && existing.email !== currentEmail) {
        await query('DELETE FROM users WHERE email = $1', [existing.email]);
      }
    }

    // Upsert each posted user
    for (const u of users) {
      const { email, pass, name, role, commission } = u;
      if (!email || !name) continue;

      const validRole = ['admin', 'staff'].includes(role) ? role : 'staff';
      const finalCommission = Number(commission) || 0;

      if (pass) {
        // Hash password if provided
        const hash = hashPassword(pass);
        await query(
          `INSERT INTO users (email, pass_hash, name, role, commission)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (email) DO UPDATE SET
             pass_hash = EXCLUDED.pass_hash,
             name = EXCLUDED.name,
             role = EXCLUDED.role,
             commission = EXCLUDED.commission`,
          [email, hash, name, validRole, finalCommission]
        );
      } else {
        // Update without changing password
        await query(
          `INSERT INTO users (email, pass_hash, name, role, commission)
           VALUES ($1, '', $3, $4, $5)
           ON CONFLICT (email) DO UPDATE SET
             name = EXCLUDED.name,
             role = EXCLUDED.role,
             commission = EXCLUDED.commission`,
          [email, '', name, validRole, finalCommission]
        );
      }
    }

    // Return sanitized list
    const { rows: result } = await query(
      'SELECT id, email, name, role, commission FROM users ORDER BY email'
    );
    res.json(result);
  } catch (err) {
    console.error('Error upserting users:', err);
    res.status(500).json({ error: err.message });
  }
});
