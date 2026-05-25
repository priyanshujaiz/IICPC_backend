import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Sidebar } from './components/Sidebar';
import { Navbar } from './components/Navbar';

// Pages (lazy stubs — we'll fill each one in)
import { LoginPage }       from './pages/LoginPage';
import { RegisterPage }    from './pages/RegisterPage';
import { DashboardPage }   from './pages/DashboardPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { SubmitPage }      from './pages/SubmitPage';
import { MyAnalyticsPage } from './pages/MyAnalyticsPage';
import { ComparePage }     from './pages/ComparePage';
import { BotActivityPage } from './pages/BotActivityPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000 },
  },
});

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="layout">
      <Sidebar />
      <div className="layout__content">
        <Navbar />
        <main className="page fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public */}
            <Route path="/"          element={<LoginPage />} />
            <Route path="/register"  element={<RegisterPage />} />

            {/* Protected — wrapped in layout shell */}
            <Route path="/dashboard" element={
              <ProtectedRoute><AppShell><DashboardPage /></AppShell></ProtectedRoute>
            } />
            <Route path="/leaderboard" element={
              <ProtectedRoute><AppShell><LeaderboardPage /></AppShell></ProtectedRoute>
            } />
            <Route path="/submit" element={
              <ProtectedRoute><AppShell><SubmitPage /></AppShell></ProtectedRoute>
            } />
            <Route path="/my-analytics" element={
              <ProtectedRoute><AppShell><MyAnalyticsPage /></AppShell></ProtectedRoute>
            } />
            <Route path="/compare" element={
              <ProtectedRoute><AppShell><ComparePage /></AppShell></ProtectedRoute>
            } />
            <Route path="/bots" element={
              <ProtectedRoute><AppShell><BotActivityPage /></AppShell></ProtectedRoute>
            } />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
