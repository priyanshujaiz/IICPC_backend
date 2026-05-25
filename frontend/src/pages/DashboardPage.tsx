import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';
import { useAuth } from '../context/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────
interface SnapshotEntry {
  rank: number;
  submissionId: string;
  compositeScore: number;
  contestantId?: string;
  language?: string;
  latencyP99?: number;
  tps?: number;
  correctnessRate?: number;
}

interface PlatformStats {
  activeSubmissions: number;
  totalBots: number;
  platformTps: number;
  avgCorrectness: number;
  avgLatencyP99: number;
  totalOrders: number;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchSnapshot(): Promise<SnapshotEntry[]> {
  const res = await fetch('/scores/snapshot');
  if (!res.ok) return [];
  return res.json();
}

async function fetchStats(): Promise<PlatformStats | null> {
  const res = await fetch('/scores/stats');
  if (!res.ok) return null;
  return res.json();
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem' }}>
      <p style={{ color: 'var(--muted)', marginBottom: 4 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color, fontFamily: 'var(--font-mono)' }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
};

// ── Mock time-series data (replaced by real data once TimescaleDB has rows) ───
function generateMockTimeSeries(points = 30) {
  return Array.from({ length: points }, (_, i) => ({
    time: `-${30 - i}m`,
    orders: Math.floor(40000 + Math.random() * 50000),
    p50: Math.floor(0.3 + Math.random() * 1.2),
    p90: Math.floor(0.8 + Math.random() * 3),
    p99: Math.floor(2 + Math.random() * 8),
    correctness: Math.floor(88 + Math.random() * 12),
    botCount: Math.floor(10 + Math.random() * 30),
  }));
}

const mockSeries = generateMockTimeSeries();

export function DashboardPage() {
  const { user } = useAuth();

  const { data: snapshot = [] } = useQuery({
    queryKey: ['snapshot'],
    queryFn: fetchSnapshot,
    refetchInterval: 5000,
  });

  const { data: stats } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: fetchStats,
    refetchInterval: 5000,
  });

  // Derived KPIs — prefer live stats, fall back to snapshot-derived values
  const activeCount = stats?.activeSubmissions ?? snapshot.filter(s => s.compositeScore > 0).length;
  const totalBots   = stats?.totalBots ?? activeCount * 5;
  const totalTps    = stats?.platformTps ?? snapshot.reduce((a, b) => a + (b.tps ?? 0), 0);
  const avgCorrect  = stats?.avgCorrectness ?? 0;
  const bestScore   = snapshot[0];

  return (
    <div className="fade-in">
      {/* Page header */}
      <div className="page-header">
        <div>
          <div className="page-header__title">
            Hey, {user?.username} 👋
          </div>
          <div className="page-header__sub">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          label="Active Submissions"
          value={activeCount.toString()}
          delta={`${activeCount} running now`}
          direction="neutral"
          icon="📦"
        />
        <KpiCard
          label="Active Bots"
          value={totalBots.toLocaleString()}
          delta={`${Math.round(totalBots / Math.max(activeCount, 1))} per submission`}
          direction="up"
          icon="🤖"
        />
        <KpiCard
          label="Platform TPS"
          value={totalTps > 0 ? totalTps.toLocaleString() : '—'}
          delta="orders/sec combined"
          direction="up"
          icon="📈"
        />
        <KpiCard
          label="Avg Correctness"
          value={avgCorrect > 0 ? `${avgCorrect.toFixed(1)}%` : bestScore ? `${(snapshot.reduce((a,b)=>a+(b.correctnessRate??0),0)/snapshot.length).toFixed(1)}%` : '—'}
          delta="across all submissions"
          direction={avgCorrect >= 95 ? 'up' : avgCorrect > 0 ? 'neutral' : 'neutral'}
          icon="✅"
        />
      </div>

      {/* Row 2: Main chart + Top teams */}
      <div className="chart-row" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card__header">
            <span className="card__title">📊 Orders Per Minute — Platform Wide</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={mockSeries}>
              <defs>
                <linearGradient id="ordersGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#4f46e5" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="orders" name="Orders/min" stroke="#4f46e5" strokeWidth={2} fill="url(#ordersGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card__header">
            <span className="card__title">🏅 Top Teams Right Now</span>
          </div>
          {snapshot.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '0.875rem', marginTop: 16 }}>
              No active submissions yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
              {snapshot.slice(0, 5).map((entry, i) => (
                <TeamBar
                  key={entry.submissionId}
                  rank={i + 1}
                  id={entry.submissionId}
                  score={entry.compositeScore}
                  maxScore={snapshot[0].compositeScore}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Three smaller charts */}
      <div className="chart-row chart-row--equal">
        <div className="card">
          <div className="card__header">
            <span className="card__title">🤖 Bot Fleet Activity</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={mockSeries.slice(-15)}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="botCount" name="Active Bots" fill="#4f46e5" opacity={0.8} radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card__header">
            <span className="card__title">⏱ Latency Distribution</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={mockSeries.slice(-15)}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="p50" name="p50" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="p90" name="p90" stroke="#64748b" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="p99" name="p99" stroke="#4f46e5" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            {[['p50', '#94a3b8'], ['p90', '#64748b'], ['p99', '#4f46e5']].map(([k, c]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: 'var(--muted)' }}>
                <div style={{ width: 16, height: 2, background: c }} />
                {k}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <span className="card__title">✅ Correctness Rate</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={mockSeries.slice(-15)}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={[80, 100]} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="correctness" name="Correctness %" fill="#00e87a" opacity={0.8} radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({ label, value, delta, direction, icon }: {
  label: string; value: string; delta: string;
  direction: 'up' | 'down' | 'neutral'; icon: string;
}) {
  const deltaColor = direction === 'up' ? 'var(--green)' : direction === 'down' ? 'var(--red)' : 'var(--muted)';
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '';
  return (
    <div className="kpi-card">
      <div className="kpi-card__label">{icon} {label}</div>
      <div className="kpi-card__value mono">{value}</div>
      <div className="kpi-card__delta" style={{ color: deltaColor }}>
        {arrow && <span>{arrow} </span>}{delta}
      </div>
    </div>
  );
}

function TeamBar({ rank, id, score, maxScore }: { rank: number; id: string; score: number; maxScore: number }) {
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const rankColors = ['#4f46e5', '#64748b', '#d97706', '#94a3b8', '#94a3b8'];
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.8rem' }}>
        <span style={{ color: rankColors[rank - 1] ?? 'var(--muted)', fontWeight: 600 }}>
          #{rank} {id.slice(0, 8)}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{score.toFixed(1)}</span>
      </div>
      <div style={{ height: 6, background: 'var(--elevated)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: rankColors[rank - 1] ?? 'var(--muted)', borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}
