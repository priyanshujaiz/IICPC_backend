import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useAuth } from '../context/AuthContext';

interface MetricPoint {
  time: string;
  latencyP50: number; latencyP90: number; latencyP99: number;
  tps: number; correctnessRate: number; compositeScore: number;
}

interface RunInfo { submissionId: string; status: string; }

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem' }}>
      <p style={{ color: 'var(--muted)', marginBottom: 4 }}>{new Date(label).toLocaleTimeString()}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color, fontFamily: 'var(--font-mono)' }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </p>
      ))}
    </div>
  );
};

export function MyAnalyticsPage() {
  const { user } = useAuth();

  // Get my latest run
  const { data: runs = [] } = useQuery<RunInfo[]>({
    queryKey: ['my-runs'],
    queryFn: async () => {
      const res = await fetch('/api/runs', { headers: { Authorization: `Bearer ${user?.token}` } });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 10_000,
  });

  const latestRun = runs[0];

  // Get metrics for latest run
  const { data: metrics } = useQuery<{ submissionId: string; dataPoints: MetricPoint[] }>({
    queryKey: ['metrics', latestRun?.submissionId],
    queryFn: async () => {
      const res = await fetch(`/metrics/${latestRun!.submissionId}`);
      if (!res.ok) return { submissionId: latestRun!.submissionId, dataPoints: [] };
      return res.json();
    },
    enabled: !!latestRun,
    refetchInterval: 5_000,
  });

  const points = metrics?.dataPoints ?? [];
  const latest = points[points.length - 1];

  if (!latestRun) {
    return (
      <div className="fade-in" style={{ textAlign: 'center', padding: '80px 32px' }}>
        <div style={{ fontSize: '3rem', marginBottom: 12 }}>📊</div>
        <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 4 }}>No submissions yet</div>
        <div style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: 20 }}>
          Submit your trading engine to see analytics
        </div>
        <a href="/submit" className="btn btn--primary">Submit Code →</a>
      </div>
    );
  }

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="page-header__title">My Analytics</div>
            <span className={`status-badge status-badge--${latestRun.status}`}>
              {latestRun.status.toUpperCase()}
            </span>
          </div>
          <div className="page-header__sub mono" style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: 4 }}>
            {latestRun.submissionId}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/compare" className="btn btn--ghost">⚔ Compare with Others</a>
          <a href="/leaderboard" className="btn btn--ghost">🏆 Leaderboard</a>
        </div>
      </div>

      {/* KPI Row */}
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi-card">
          <div className="kpi-card__label">🏆 Composite Score</div>
          <div className="kpi-card__value mono" style={{ color: 'var(--accent)' }}>
            {latest?.compositeScore.toFixed(1) ?? '—'}
          </div>
          <div className="kpi-card__delta delta--neutral">out of 100</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">⚡ p99 Latency</div>
          <div className="kpi-card__value mono" style={{ color: latest?.latencyP99 != null ? (latest.latencyP99 < 5 ? 'var(--green)' : latest.latencyP99 < 20 ? 'var(--orange)' : 'var(--red)') : 'var(--text)' }}>
            {latest?.latencyP99 != null ? `${latest.latencyP99.toFixed(1)}ms` : '—'}
          </div>
          <div className="kpi-card__delta delta--neutral">worst-case latency</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">📈 Peak TPS</div>
          <div className="kpi-card__value mono">
            {latest?.tps != null ? latest.tps.toLocaleString() : '—'}
          </div>
          <div className="kpi-card__delta delta--up">orders per second</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">✅ Correctness</div>
          <div className="kpi-card__value mono" style={{ color: latest?.correctnessRate != null ? (latest.correctnessRate >= 95 ? 'var(--green)' : latest.correctnessRate >= 80 ? 'var(--orange)' : 'var(--red)') : 'var(--text)' }}>
            {latest?.correctnessRate != null ? `${latest.correctnessRate.toFixed(1)}%` : '—'}
          </div>
          <div className="kpi-card__delta delta--neutral">fill accuracy</div>
        </div>
      </div>

      {/* Charts row */}
      <div className="chart-row chart-row--half" style={{ marginBottom: 20 }}>
        {/* Latency chart */}
        <div className="card">
          <div className="card__header">
            <span className="card__title">⏱ Latency Over Time (last 5 min)</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={points}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="time" tickFormatter={v => new Date(v).toLocaleTimeString()} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis unit="ms" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="latencyP50" name="p50" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="latencyP90" name="p90" stroke="#64748b" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="latencyP99" name="p99" stroke="#4f46e5" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            {[['p50', '#94a3b8'], ['p90', '#64748b'], ['p99', '#4f46e5']].map(([k, c]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--muted)' }}>
                <div style={{ width: 16, height: 2, background: c, borderRadius: 1 }} />
                {k} latency
              </div>
            ))}
          </div>
        </div>

        {/* TPS chart */}
        <div className="card">
          <div className="card__header">
            <span className="card__title">📈 Throughput (TPS)</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={points}>
              <defs>
                <linearGradient id="tpsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="time" tickFormatter={v => new Date(v).toLocaleTimeString()} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="tps" name="TPS" stroke="#4f46e5" strokeWidth={2} fill="url(#tpsGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Correctness + Score row */}
      <div className="chart-row chart-row--half">
        {/* Correctness ring */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <CorrectnessRing value={latest?.correctnessRate ?? 0} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 8 }}>Fill Correctness</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.8 }}>
              Your engine processes MARKET orders.<br />
              Correctness measures how accurately<br />
              fills match the reference implementation.
            </div>
          </div>
        </div>

        {/* Score over time */}
        <div className="card">
          <div className="card__header">
            <span className="card__title">🏆 Composite Score Over Time</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={points}>
              <defs>
                <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="time" tickFormatter={v => new Date(v).toLocaleTimeString()} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="compositeScore" name="Score" stroke="#10b981" strokeWidth={2} fill="url(#scoreGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function CorrectnessRing({ value }: { value: number }) {
  const size = 120;
  const r = 50;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, value));
  const dash = (pct / 100) * circ;
  const color = pct >= 95 ? '#00e87a' : pct >= 80 ? '#ffa502' : '#ff4757';

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={10} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem', fontWeight: 700, color }}>{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}
