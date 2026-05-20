import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { getEnv } from '@iicpc/shared';

export const authRouter:Router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// POST /auth/login
// Body: { username, password }
// Returns: { token }
authRouter.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const { username, password } = parsed.data;

  const ADMIN_USER = getEnv('ADMIN_USERNAME');
  const ADMIN_PASS = getEnv('ADMIN_PASSWORD');
  const JWT_SECRET = getEnv('JWT_SECRET');

  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = jwt.sign(
    { sub: username, role: 'admin' },
    JWT_SECRET,
    { expiresIn: '30d' }, // long-lived for demo — never expires during judging
  );

  res.json({ token });
});
