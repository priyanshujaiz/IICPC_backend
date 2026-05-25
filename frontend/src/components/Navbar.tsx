import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const pageNames: Record<string, string> = {
  '/dashboard':    'Dashboard',
  '/leaderboard':  'Leaderboard',
  '/submit':       'Submit Code',
  '/my-analytics': 'My Analytics',
  '/compare':      'Compare',
  '/bots':         'Bot Activity',
};

export function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const pageName = pageNames[location.pathname] ?? 'IICPC HFT Platform';

  return (
    <header className="navbar">
      <div className="navbar__left">
        <span className="navbar__breadcrumb">IICPC HFT Platform</span>
        <span className="navbar__breadcrumb" style={{ color: 'var(--border)' }}> / </span>
        <span className="navbar__page">{pageName}</span>
      </div>

      <div className="navbar__right">
        <div className="live-badge">
          <div className="live-dot" />
          LIVE
        </div>

        {user && (
          <div className="user-chip" onClick={logout} title="Click to logout">
            <div className="user-avatar">
              {user.username.slice(0, 2).toUpperCase()}
            </div>
            <span>{user.username}</span>
          </div>
        )}
      </div>
    </header>
  );
}
