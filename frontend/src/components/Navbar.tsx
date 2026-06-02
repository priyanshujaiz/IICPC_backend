import { useState, useRef, useEffect } from 'react';
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

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

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
          <div className="user-chip-wrapper" ref={dropdownRef}>
            <div
              className="user-chip"
              onClick={() => setDropdownOpen(prev => !prev)}
              title="Account menu"
            >
              <div className="user-avatar">
                {(user.teamName ?? user.username).slice(0, 2).toUpperCase()}
              </div>
              <span>{user.teamName ?? user.username}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 2, transition: 'transform 200ms', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0)' }}>
                <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            {dropdownOpen && (
              <div className="user-dropdown">
                {/* User info header */}
                <div className="user-dropdown__header">
                  <div className="user-dropdown__avatar">
                    {(user.teamName ?? user.username).slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="user-dropdown__name">{user.teamName ?? user.username}</div>
                    <div className="user-dropdown__meta">
                      {user.email && <span>{user.email}</span>}
                      {!user.email && <span>@{user.username}</span>}
                    </div>
                  </div>
                </div>

                <div className="user-dropdown__divider" />

                {/* Role badge */}
                <div className="user-dropdown__item" style={{ cursor: 'default' }}>
                  <span style={{ fontSize: '0.85rem' }}>👤</span>
                  <span>Role</span>
                  <span className="user-dropdown__role-badge">
                    {user.role === 'admin' ? '🛡 Admin' : '🏆 Contestant'}
                  </span>
                </div>

                <div className="user-dropdown__divider" />

                {/* Logout */}
                <div
                  className="user-dropdown__item user-dropdown__item--danger"
                  onClick={() => { setDropdownOpen(false); logout(); }}
                >
                  <span style={{ fontSize: '0.85rem' }}>🚪</span>
                  <span>Sign out</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
