import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

/** Turn zod fieldErrors object OR string into a displayable error message */
function formatApiError(err: unknown, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    // Zod fieldErrors: { field: ["msg1", "msg2"], ... }
    const msgs = Object.entries(err as Record<string, string[]>)
      .map(([field, errors]) => `${field}: ${errors.join(', ')}`)
      .join('; ');
    return msgs || fallback;
  }
  return fallback;
}

interface User {
  userId: string;
  username: string;
  teamName: string;
  email: string | null;
  role: 'admin' | 'contestant';
  token: string;
}

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, teamName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const USER_KEY  = 'iicpc_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [isLoading, setLoading] = useState(true);

  // Restore session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(USER_KEY);
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch { localStorage.removeItem(USER_KEY); }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(formatApiError(err.error, 'Login failed'));
    }
    const data = await res.json();
    const u: User = {
      userId: data.userId,
      username: data.username,
      teamName: data.teamName ?? data.username,
      email: data.email ?? null,
      role: data.role,
      token: data.token,
    };
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setUser(u);
  }, []);

  const register = useCallback(async (username: string, teamName: string, email: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, teamName, email: email || undefined, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(formatApiError(err.error, 'Registration failed'));
    }
    const data = await res.json();
    const u: User = {
      userId: data.userId,
      username: data.username,
      teamName: data.teamName ?? data.username,
      email: data.email ?? null,
      role: data.role,
      token: data.token,
    };
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, register, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

