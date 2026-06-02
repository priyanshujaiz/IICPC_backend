import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [teamName, setTeamName]   = useState('');
  const [username, setUsername]   = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 6)  { setError('Password must be at least 6 characters'); return; }
    setError(''); setLoading(true);
    try {
      await register(username, teamName, email, password);
      navigate('/submit');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Left — Branding (Same as Login) */}
      <div className="auth-left">
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />
        <div style={{ position: 'relative', zIndex: 1, maxWidth: 480 }}>
          <div style={{ width: 56, height: 56, background: 'var(--accent)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem', fontWeight: 800, color: '#fff', marginBottom: 32, boxShadow: '0 8px 24px rgba(79, 70, 229, 0.4)' }}>
            H
          </div>
          <h1 style={{ fontSize: '3.5rem', fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.1, marginBottom: 24, color: '#fff' }}>
            IICPC HFT<br />Platform
          </h1>
          <p style={{ fontSize: '1.125rem', color: '#cbd5e1', lineHeight: 1.6, marginBottom: 40 }}>
            Create an account to deploy your engine and see how you stack up on the global leaderboard.
          </p>
        </div>
      </div>

      {/* Right — Register card */}
      <div className="auth-right">
        <div className="auth-card">
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: 8, letterSpacing: '-0.02em' }}>
              Register your team
            </h2>
            <p style={{ fontSize: '1rem', color: 'var(--muted)' }}>
              Create an account to start competing
            </p>
          </div>

          {error && (
            <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 12, padding: '12px 16px', fontSize: '0.9rem', color: 'var(--red)', marginBottom: 20, fontWeight: 500 }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="input-group">
              <label className="input-label">Team Name</label>
              <input className="input" type="text" placeholder="e.g. Team Alpha" value={teamName} onChange={e => setTeamName(e.target.value)} required autoFocus />
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: -4 }}>Displayed on the leaderboard</span>
            </div>

            <div className="input-group">
              <label className="input-label">Username</label>
              <input className="input" type="text" placeholder="Unique login ID (letters, numbers, _ -)" value={username} onChange={e => setUsername(e.target.value)} required />
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: -4 }}>Used for sign-in — cannot be changed</span>
            </div>

            <div className="input-group">
              <label className="input-label">Email <span style={{ fontWeight: 400, color: 'var(--dim)' }}>(optional)</span></label>
              <input className="input" type="email" placeholder="team@example.com" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            
            <div className="input-group">
              <label className="input-label">Password</label>
              <input className="input" type="password" placeholder="Min 6 characters" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            
            <div className="input-group">
              <label className="input-label">Confirm Password</label>
              <input className={`input${error.includes('match') ? ' input--error' : ''}`} type="password" placeholder="Repeat password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
            </div>

            <button type="submit" className="btn btn--primary btn--full btn--lg" disabled={loading} style={{ marginTop: 8 }}>
              {loading ? 'Creating account...' : 'Register'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 24, fontSize: '0.95rem', color: 'var(--muted)' }}>
            Already registered?{' '}
            <Link to="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

