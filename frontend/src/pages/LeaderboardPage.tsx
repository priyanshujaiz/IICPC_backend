import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, ResponsiveContainer
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────
interface LiveEntry {
  rank: number;
  submissionId: string;
  compositeScore: number;
  contestantId?: string;
  language?: string;
  status?: string;
  latencyP50?: number;
  latencyP90?: number;
  latencyP99?: number;
  tps?: number;
  correctnessRate?: number;
}

// ── SSE Hook ──────────────────────────────────────────────────────────────────
function useLeaderboard() {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/scores/stream');

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as LiveEntry[];
        setEntries(data);
      } catch { /* skip malformed */ }
    };

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects — don't close
    };

    return () => es.close();
  }, []);

  return { entries, connected };
}

// ── Sparkline (60s trend) ─────────────────────────────────────────────────────
// We keep a rolling history per submission to power the sparkline
function useSparklines(entries: LiveEntry[]) {
  const history = useRef<Record<string, number[]>>({});

  entries.forEach(e => {
    if (!history.current[e.submissionId]) history.current[e.submissionId] = [];
    const arr = history.current[e.submissionId];
    arr.push(e.compositeScore);
    if (arr.length > 60) arr.shift();  // keep last 60s
  });

  return history.current;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function LeaderboardPage() {
  const { entries, connected } = useLeaderboard();
  const sparklines = useSparklines(entries);
  const navigate = useNavigate();
  const [sortBy, setSortBy] = useState<'score' | 'p99' | 'tps' | 'correctness'>('score');

  const sorted = [...entries].sort((a, b) => {
    if (sortBy === 'p99') return (a.latencyP99 ?? 999) - (b.latencyP99 ?? 999);
    if (sortBy === 'tps') return (b.tps ?? 0) - (a.tps ?? 0);
    if (sortBy === 'correctness') return (b.correctnessRate ?? 0) - (a.correctnessRate ?? 0);
    return b.compositeScore - a.compositeScore;
  });

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="page-header__title">Live Leaderboard</div>
            <div className={`live-badge${!connected ? ' live-badge--offline' : ''}`}>
              <div className="live-dot" style={{ background: connected ? 'var(--green)' : 'var(--red)' }} />
              {connected ? 'LIVE' : 'RECONNECTING'}
            </div>
          </div>
          <div className="page-header__sub">
            {entries.length} active submission{entries.length !== 1 ? 's' : ''} · updates every second
          </div>
        </div>

        {/* Sort controls */}
        <div style={{ display: 'flex', gap: 8 }}>
          {(['score', 'p99', 'tps', 'correctness'] as const).map(key => (
            <button
              key={key}
              className={`btn btn--ghost`}
              onClick={() => setSortBy(key)}
              style={{
                padding: '6px 14px', fontSize: '0.75rem',
                borderColor: sortBy === key ? 'var(--accent)' : undefined,
                color: sortBy === key ? 'var(--accent)' : undefined,
              }}
            >
              {key === 'score' ? 'Score' : key === 'p99' ? 'p99 Latency' : key === 'tps' ? 'TPS' : 'Correctness'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {entries.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="lb-table">
            <thead>
              <tr>
                <th style={{ width: 56 }}>#</th>
                <th>Team</th>
                <th>Score</th>
                <th>p99 Latency</th>
                <th>p50 Latency</th>
                <th>TPS</th>
                <th>Correctness</th>
                <th>Status</th>
                <th style={{ width: 100 }}>60s Trend</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry, i) => {
                const sparkData = (sparklines[entry.submissionId] ?? [entry.compositeScore])
                  .map((v, idx) => ({ v, idx }));
                const prevScore = sparkData.length >= 2 ? sparkData[sparkData.length - 2].v : entry.compositeScore;
                const trend = entry.compositeScore > prevScore ? 'up' : entry.compositeScore < prevScore ? 'down' : 'neutral';

                return (
                  <tr
                    key={entry.submissionId}
                    onClick={() => navigate(`/my-analytics`)}
                    style={{ transition: 'background 200ms' }}
                  >
                    {/* Rank */}
                    <td>
                      <RankBadge rank={i + 1} />
                    </td>

                    {/* Team name + language */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                            {entry.contestantId ?? entry.submissionId.slice(0, 8)}
                          </div>
                          <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                            {entry.submissionId.slice(0, 8)}…
                          </div>
                        </div>
                        {entry.language && (
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px',
                            borderRadius: 4, background: 'var(--elevated)',
                            border: '1px solid var(--border)', color: 'var(--muted)',
                            textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0,
                          }}>{entry.language}</span>
                        )}
                      </div>
                    </td>

                    {/* Score */}
                    <td>
                      <span className="mono" style={{
                        fontSize: '1.1rem', fontWeight: 700,
                        color: i === 0 ? 'var(--accent)' : 'var(--text)',
                      }}>
                        {entry.compositeScore.toFixed(1)}
                      </span>
                      <span style={{ marginLeft: 4, fontSize: '0.75rem', color: trend === 'up' ? 'var(--green)' : trend === 'down' ? 'var(--red)' : 'var(--muted)' }}>
                        {trend === 'up' ? '↑' : trend === 'down' ? '↓' : ''}
                      </span>
                    </td>

                    {/* p99 */}
                    <td>
                      <LatencyCell value={entry.latencyP99} />
                    </td>

                    {/* p50 */}
                    <td>
                      <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                        {entry.latencyP50 != null ? `${entry.latencyP50.toFixed(1)}ms` : '—'}
                      </span>
                    </td>

                    {/* TPS */}
                    <td>
                      <span className="mono" style={{ fontSize: '0.9rem' }}>
                        {entry.tps != null ? entry.tps.toLocaleString() : '—'}
                      </span>
                    </td>

                    {/* Correctness */}
                    <td>
                      <CorrectnessBar value={entry.correctnessRate} />
                    </td>

                    {/* Status */}
                    <td>
                      <span className={`status-badge status-badge--${entry.status === 'running' ? 'live' : (entry.status ?? 'live')}`}>
                        {entry.status === 'running' || !entry.status ? (
                          <><span className="live-dot" style={{ width: 5, height: 5 }} />LIVE</>
                        ) : entry.status.toUpperCase()}
                      </span>
                    </td>

                    {/* Sparkline */}
                    <td>
                      <ResponsiveContainer width={100} height={36}>
                        <LineChart data={sparkData}>
                          <Line
                            type="monotone"
                            dataKey="v"
                            stroke={i === 0 ? '#4f46e5' : '#94a3b8'}
                            strokeWidth={1.5}
                            dot={false}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  const cls = rank === 1 ? 'rank-badge--1' : rank === 2 ? 'rank-badge--2' : rank === 3 ? 'rank-badge--3' : 'rank-badge--other';
  return (
    <div className={`rank-badge ${cls}`} style={{ fontFamily: 'var(--font-mono)' }}>
      {rank}
    </div>
  );
}

function LatencyCell({ value }: { value?: number }) {
  if (value == null) return <span style={{ color: 'var(--muted)' }}>—</span>;
  const color = value < 2 ? 'var(--green)' : value < 10 ? 'var(--orange)' : 'var(--red)';
  return (
    <span className="mono" style={{ fontSize: '0.9rem', fontWeight: 600, color }}>
      {value.toFixed(1)}ms
    </span>
  );
}

function CorrectnessBar({ value }: { value?: number }) {
  if (value == null) return <span style={{ color: 'var(--muted)' }}>—</span>;
  const color = value >= 95 ? 'var(--green)' : value >= 80 ? 'var(--orange)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 60, height: 4, background: 'var(--elevated)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 2, transition: 'width 0.4s ease' }} />
      </div>
      <span className="mono" style={{ fontSize: '0.75rem', color }}>{value.toFixed(1)}%</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ padding: '64px 32px', textAlign: 'center' }}>
      <div style={{ fontSize: '3rem', marginBottom: 12 }}>🏁</div>
      <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 4 }}>No active submissions yet</div>
      <div style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
        Once a team submits code and it starts running, scores will appear here in real-time.
      </div>
    </div>
  );
}
