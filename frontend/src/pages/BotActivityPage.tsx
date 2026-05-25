import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts';

interface SnapshotEntry {
  rank: number; submissionId: string; compositeScore: number;
  latencyP99?: number; tps?: number; correctnessRate?: number;
}

async function fetchSnapshot(): Promise<SnapshotEntry[]> {
  const res = await fetch('/scores/snapshot');
  if (!res.ok) return [];
  return res.json();
}

// Mock bot-per-submission data (replace with real endpoint when available)
function mockBotData(submissions: SnapshotEntry[]) {
  return Array.from({ length: 20 }, (_, i) => {
    const point: Record<string, number | string> = { time: `-${20 - i}m` };
    submissions.slice(0, 5).forEach(s => {
      point[s.submissionId.slice(0, 6)] = Math.floor(3 + Math.random() * 3);
    });
    return point;
  });
}

const STACK_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#6366f1'];

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem' }}>
      <p style={{ color: 'var(--muted)', marginBottom: 4 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color, fontFamily: 'var(--font-mono)' }}>
          {p.dataKey}: {p.value} bots
        </p>
      ))}
    </div>
  );
};

export function BotActivityPage() {
  const { data: snapshot = [] } = useQuery({
    queryKey: ['snapshot'],
    queryFn: fetchSnapshot,
    refetchInterval: 5000,
  });

  const botHistory = mockBotData(snapshot);
  const submissionKeys = snapshot.slice(0, 5).map(s => s.submissionId.slice(0, 6));

  // Simulated total TPS per time window
  const tpsHistory = Array.from({ length: 30 }, (_, i) => ({
    time: `-${30 - i}m`,
    tps: Math.floor(60000 + Math.random() * 30000),
  }));

  // Mock events feed
  const events = [
    { time: new Date().toLocaleTimeString(), msg: `Submission ${snapshot[0]?.submissionId?.slice(0, 8) ?? 'abc12345'} went LIVE`, type: 'live' },
    { time: new Date(Date.now() - 45000).toLocaleTimeString(), msg: 'Bot fleet spawned 5 workers for submission', type: 'info' },
    { time: new Date(Date.now() - 90000).toLocaleTimeString(), msg: `Submission ${snapshot[1]?.submissionId?.slice(0, 8) ?? 'def67890'} started BUILDING`, type: 'building' },
    { time: new Date(Date.now() - 180000).toLocaleTimeString(), msg: 'Sandbox finished building image (18.3s)', type: 'info' },
    { time: new Date(Date.now() - 300000).toLocaleTimeString(), msg: 'New submission uploaded by team', type: 'info' },
  ];

  const eventColor = (type: string) =>
    type === 'live' ? 'var(--green)' : type === 'building' ? 'var(--orange)' : 'var(--muted)';

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <div className="page-header__title">Bot Activity</div>
          <div className="page-header__sub">
            Real-time view of bot workers firing at each submission
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi-card">
          <div className="kpi-card__label">🤖 Total Active Bots</div>
          <div className="kpi-card__value mono">{snapshot.length * 5}</div>
          <div className="kpi-card__delta delta--up">5 per submission</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">📦 Submissions Running</div>
          <div className="kpi-card__value mono">{snapshot.length}</div>
          <div className="kpi-card__delta delta--neutral">active now</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">⚡ Total Platform TPS</div>
          <div className="kpi-card__value mono">
            {snapshot.reduce((a, b) => a + (b.tps ?? 0), 0).toLocaleString()}
          </div>
          <div className="kpi-card__delta delta--up">orders/sec all bots</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">📊 Avg Correctness</div>
          <div className="kpi-card__value mono">
            {snapshot.length > 0
              ? (snapshot.reduce((a, b) => a + (b.correctnessRate ?? 0), 0) / snapshot.length).toFixed(1) + '%'
              : '—'}
          </div>
          <div className="kpi-card__delta delta--neutral">across all submissions</div>
        </div>
      </div>

      {/* Charts row */}
      <div className="chart-row chart-row--half" style={{ marginBottom: 20 }}>
        {/* Stacked bot activity */}
        <div className="card">
          <div className="card__header">
            <span className="card__title">🤖 Active Bots per Submission</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={botHistory}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip content={<ChartTooltip />} />
              {submissionKeys.map((key, i) => (
                <Bar key={key} dataKey={key} stackId="bots" fill={STACK_COLORS[i]} opacity={0.85} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Total TPS area */}
        <div className="card">
          <div className="card__header">
            <span className="card__title">⚡ Platform-Wide TPS</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={tpsHistory}>
              <defs>
                <linearGradient id="tpsBotGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="tps" name="TPS" stroke="#4f46e5" strokeWidth={2} fill="url(#tpsBotGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bot table + Events feed */}
      <div className="chart-row chart-row--half">
        {/* Per-submission bot table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <span className="card__title">Per-Submission Bot Status</span>
          </div>
          {snapshot.length === 0 ? (
            <div style={{ padding: 32, color: 'var(--muted)', textAlign: 'center' }}>No active submissions</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Submission</th>
                  <th style={{ padding: '10px 16px', color: 'var(--muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Bots</th>
                  <th style={{ padding: '10px 16px', color: 'var(--muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>TPS</th>
                  <th style={{ padding: '10px 16px', color: 'var(--muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Circuit</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.map((s, i) => (
                  <tr key={s.submissionId} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', color: STACK_COLORS[i] ?? 'var(--text)' }}>
                      {s.submissionId.slice(0, 10)}…
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>5/5</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                      {s.tps?.toLocaleString() ?? '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--green)', fontWeight: 600 }}>CLOSED ✓</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Events feed */}
        <div className="card">
          <div className="card__header">
            <span className="card__title">📋 Event Feed</span>
            <div className="live-badge" style={{ fontSize: '0.7rem' }}>
              <div className="live-dot" />LIVE
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {events.map((ev, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 0',
                borderBottom: i < events.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: eventColor(ev.type), flexShrink: 0, marginTop: 6 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>{ev.msg}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{ev.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
