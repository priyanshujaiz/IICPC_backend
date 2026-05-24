import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { eq } from 'drizzle-orm';
import { getEnv } from '@iicpc/shared';
import { users } from '@iicpc/shared';
import { db } from '../db.js';

export const authRouter: Router = Router();

const JWT_SECRET  = getEnv('JWT_SECRET');
const SALT_ROUNDS = 10;

const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, {
    message: 'username can only contain letters, numbers, _ and -',
  }),
  password: z.string().min(6),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

function issueToken(userId: string, username: string, role: string): string {
  return jwt.sign(
    { sub: userId, username, role },
    JWT_SECRET,
    { expiresIn: '30d' },
  );
}

// ── POST /auth/register ───────────────────────────────────────────────────────

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }

  const { username, password } = parsed.data;

  // Check username is not already taken
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (existing.length > 0) {
    return res.status(409).json({ error: 'username already taken' });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const userId       = uuid();

  await db.insert(users).values({
    id:           userId,
    username,
    passwordHash,
    role:         'contestant',
  });

  console.log(`[gateway] registered new contestant: ${username} (${userId})`);

  const token = issueToken(userId, username, 'contestant');
  return res.status(201).json({ token, userId, username, role: 'contestant' });
});

// ── POST /auth/login ──────────────────────────────────────────────────────────

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const { username, password } = parsed.data;

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (rows.length === 0) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const user = rows[0];
  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const token = issueToken(user.id, user.username, user.role);
  return res.json({ token, userId: user.id, username: user.username, role: user.role });
});
