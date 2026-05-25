import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';

interface SnapshotEntry {
  rank: number; submissionId: string; compositeScore: number;
  latencyP99?: number; tps?: number; correctnessRate?: number;
}
interface MetricPoint {
  time: string; latencyP99: number; tps: number; compositeScore: number; correctnessRate: number;
}

async function fetchSnapshot(): Promise<SnapshotEntry[]> {
  const res = await fetch('/scores/snapshot');
  if (!res.ok) return [];
  return res.json();
}

async function fetchMetrics(id: string): Promise<MetricPoint[]> {
  const res = await fetch(`/metrics/${id}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.dataPoints ?? [];
}

const COLORS = { a: '#4f46e5', b: '#f59e0b' };

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem' }}>
      <p style={{ color: 'var(--muted)', marginBottom: 4 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color, fontFamily: 'var(--font-mono)' }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </p>
      ))}
    </div>
  );
};

export function ComparePage() {
  const { data: snapshot = [] } = useQuery({ queryKey: ['snapshot'], queryFn: fetchSnapshot, refetchInterval: 5000 });

  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [metric, setMetric] = useState<'compositeScore' | 'latencyP99' | 'tps' | 'correctnessRate'>('compositeScore');

  const { data: metricsA = [] } = useQuery({ queryKey: ['metrics', teamA], queryFn: () => fetchMetrics(teamA), enabled: !!teamA, refetchInterval: 5000 });
  const { data: metricsB = [] } = useQuery({ queryKey: ['metrics', teamB], queryFn: () => fetchMetrics(teamB), enabled: !!teamB, refetchInterval: 5000 });

  const entryA = snapshot.find(s => s.submissionId === teamA);
  const entryB = snapshot.find(s => s.submissionId === teamB);

  // Build radar data
  function normalize(val: number | undefined, min: number, max: number) {
    if (val == null) return 0;
    return Math.round(((val - min) / (max - min)) * 100);
  }

  const allScores = snapshot.map(s => s.compositeScore);
  const allP99    = snapshot.map(s => s.latencyP99 ?? 999);
  const allTps    = snapshot.map(s => s.tps ?? 0);
  const allCorr   = snapshot.map(s => s.correctnessRate ?? 0);

  const radarData = [
    { metric: 'Score',       A: normalize(entryA?.compositeScore, Math.min(...allScores), Math.max(...allScores)), B: normalize(entryB?.compositeScore, Math.min(...allScores), Math.max(...allScores)) },
    { metric: 'Latency',     A: 100 - normalize(entryA?.latencyP99, Math.min(...allP99), Math.max(...allP99)), B: 100 - normalize(entryB?.latencyP99, Math.min(...allP99), Math.max(...allP99)) },
    { metric: 'TPS',         A: normalize(entryA?.tps, Math.min(...allTps), Math.max(...allTps)), B: normalize(entryB?.tps, Math.min(...allTps), Math.max(...allTps)) },
    { metric: 'Correctness', A: normalize(entryA?.correctnessRate, Math.min(...allCorr), Math.max(...allCorr)), B: normalize(entryB?.correctnessRate, Math.min(...allCorr), Math.max(...allCorr)) },
  ];

  // Merge time series for dual chart
  const combined = metricsA.map((pt, i) => ({
    time: pt.time,
    A: (pt as any)[metric],
    B: (metricsB[i] as any)?.[metric],
  }));

  const metrics: { key: typeof metric; label: string }[] = [
    { key: 'compositeScore',   label: 'Score' },
    { key: 'latencyP99',       label: 'p99 Latency' },
    { key: 'tps',              label: 'TPS' },
    { key: 'correctnessRate',  label: 'Correctness' },
  ];

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <div className="page-header__title">Compare Submissions</div>
          <div className="page-header__sub">Side-by-side performance analysis</div>
        </div>
      </div>

      {/* Team selectors */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, alignItems: 'center', marginBottom: 24 }}>
        <select className="input" value={teamA} onChange={e => setTeamA(e.target.value)}>
          <option value="">Select Team A…</option>
          {snapshot.map(s => <option key={s.submissionId} value={s.submissionId}>#{s.rank} — {s.submissionId.slice(0, 12)} (Score: {s.compositeScore.toFixed(1)})</option>)}
        </select>
        <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.25rem', color: 'var(--muted)' }}>VS</div>
        <select className="input" value={teamB} onChange={e => setTeamB(e.target.value)}>
          <option value="">Select Team B…</option>
          {snapshot.map(s => <option key={s.submissionId} value={s.submissionId}>#{s.rank} — {s.submissionId.slice(0, 12)} (Score: {s.compositeScore.toFixed(1)})</option>)}
        </select>
      </div>

      {/* KPI comparison table */}
      {(entryA || entryB) && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card__header">
            <span className="card__title">Head-to-Head Comparison</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Metric</th>
                <th style={{ textAlign: 'center', padding: '8px 12px', color: COLORS.a }}>Team A</th>
                <th style={{ textAlign: 'center', padding: '8px 12px', color: COLORS.b }}>Team B</th>
                <th style={{ textAlign: 'center', padding: '8px 12px', color: 'var(--muted)', fontSize: '0.75rem' }}>Winner</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Composite Score', a: entryA?.compositeScore, b: entryB?.compositeScore, higher: true, fmt: (v: number) => v.toFixed(1) },
                { label: 'p99 Latency',     a: entryA?.latencyP99, b: entryB?.latencyP99, higher: false, fmt: (v: number) => `${v.toFixed(1)}ms` },
                { label: 'TPS',             a: entryA?.tps, b: entryB?.tps, higher: true, fmt: (v: number) => v.toLocaleString() },
                { label: 'Correctness',     a: entryA?.correctnessRate, b: entryB?.correctnessRate, higher: true, fmt: (v: number) => `${v.toFixed(1)}%` },
              ].map(row => {
                const aWins = row.a != null && row.b != null && (row.higher ? row.a > row.b : row.a < row.b);
                const bWins = row.a != null && row.b != null && (row.higher ? row.b > row.a : row.b < row.a);
                return (
                  <tr key={row.label} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px', color: 'var(--muted)', fontSize: '0.8rem' }}>{row.label}</td>
                    <td style={{ padding: '12px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: aWins ? 700 : 400, color: aWins ? COLORS.a : 'var(--text)' }}>
                      {row.a != null ? row.fmt(row.a) : '—'}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: bWins ? 700 : 400, color: bWins ? COLORS.b : 'var(--text)' }}>
                      {row.b != null ? row.fmt(row.b) : '—'}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center', fontSize: '0.875rem' }}>
                      {aWins ? <span style={{ color: COLORS.a }}>🏆 A</span> : bWins ? <span style={{ color: COLORS.b }}>🏆 B</span> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Charts row */}
      <div className="chart-row chart-row--half">
        {/* Dual timeline chart */}
        <div className="card">
          <div className="card__header">
            <span className="card__title">Timeline Comparison</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {metrics.map(m => (
                <button key={m.key} onClick={() => setMetric(m.key)}
                  className="btn btn--ghost"
                  style={{ padding: '4px 10px', fontSize: '0.7rem', borderColor: metric === m.key ? 'var(--accent)' : undefined, color: metric === m.key ? 'var(--accent)' : undefined }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={combined}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="time" tickFormatter={v => new Date(v).toLocaleTimeString()} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
              <Line type="monotone" dataKey="A" name="Team A" stroke={COLORS.a} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="B" name="Team B" stroke={COLORS.b} strokeWidth={2} dot={false} strokeDasharray="6 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Radar */}
        <div className="card">
          <div className="card__header">
            <span className="card__title">Strength Radar</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#cbd5e1" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: '#64748b', fontSize: 11 }} />
              <Radar name="Team A" dataKey="A" stroke={COLORS.a} fill={COLORS.a} fillOpacity={0.15} />
              <Radar name="Team B" dataKey="B" stroke={COLORS.b} fill={COLORS.b} fillOpacity={0.15} />
              <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
