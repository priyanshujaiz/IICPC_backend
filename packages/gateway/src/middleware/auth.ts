import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { getEnv } from '@iicpc/shared';

// ── Extend Express Request globally ──────────────────────────────────────────
// Every route handler can now access req.user.userId, req.user.username, req.user.role

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId:   string;                    // UUID — primary key from users table
        username: string;                    // human-readable team/contestant name
        role:     'admin' | 'contestant';
      };
    }
  }
}

const JWT_SECRET = getEnv('JWT_SECRET');

/**
 * requireAuth
 * Verifies the Bearer JWT and attaches req.user.
 * Returns 401 if token is missing, malformed, or expired.
 * Apply to any route that needs a logged-in user.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = header.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      sub:      string;   // userId UUID
      username: string;
      role:     string;
    };

    req.user = {
      userId:   payload.sub,
      username: payload.username,
      role:     payload.role as 'admin' | 'contestant',
    };

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * requireAdmin
 * Use AFTER requireAuth on admin-only routes.
 * Returns 403 if the authenticated user is not an admin.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
