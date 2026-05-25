import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { icon: '⊞', label: 'Dashboard',   to: '/dashboard'    },
  { icon: '🏆', label: 'Leaderboard', to: '/leaderboard'  },
  { icon: '↑',  label: 'Submit',      to: '/submit'       },
  { icon: '📊', label: 'My Analytics',to: '/my-analytics' },
  { icon: '⚔',  label: 'Compare',     to: '/compare'      },
  { icon: '🤖', label: 'Bot Activity',to: '/bots'         },
];

export function Sidebar() {
  const { logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar__logo">H</div>

      <nav className="sidebar__nav">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `sidebar__item${isActive ? ' active' : ''}`
            }
          >
            <span className="sidebar__icon">{item.icon}</span>
            <span className="sidebar__label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div style={{ marginTop: 'auto' }}>
        <button
          className="sidebar__item"
          onClick={logout}
          style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', color: 'var(--muted)' }}
        >
          <span className="sidebar__icon">⏻</span>
          <span className="sidebar__label">Logout</span>
        </button>
      </div>
    </aside>
  );
}
