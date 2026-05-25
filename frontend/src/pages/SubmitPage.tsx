import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

type Status = 'queued' | 'building' | 'running' | 'stopped' | 'error';
type Language = 'cpp' | 'rust' | 'go';

const LANGUAGES: { key: Language; label: string; icon: string; desc: string }[] = [
  { key: 'cpp',  label: 'C++',  icon: '⚙️', desc: 'Compiled with gcc:12' },
  { key: 'rust', label: 'Rust', icon: '🦀', desc: 'Compiled with rust:stable' },
  { key: 'go',   label: 'Go',   icon: '🐹', desc: 'Compiled with go:1.21' },
];

const STEPS = ['Uploading', 'Building', 'Running', 'Live'];

function statusToStep(status: Status): number {
  return { queued: 0, building: 1, running: 2, stopped: -1, error: -1 }[status] ?? 0;
}

export function SubmitPage() {
  const { user } = useAuth();
  const [language, setLanguage] = useState<Language>('cpp');
  const [file, setFile]         = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping]     = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [status, setStatus]     = useState<Status | null>(null);
  const [error, setError]       = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleFile = (f: File) => {
    if (!f.name.endsWith('.zip') && !f.name.endsWith('.tar.gz')) {
      setError('Only .zip or .tar.gz files are accepted');
      return;
    }
    setFile(f);
    setError('');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const startPolling = (id: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs/${id}`, {
          headers: { Authorization: `Bearer ${user?.token}` },
        });
        const data = await res.json();
        const s: Status = data.status;
        setStatus(s);
        if (s === 'running' || s === 'stopped' || s === 'error') {
          clearInterval(pollRef.current!);
        }
      } catch { /* keep polling */ }
    }, 2000);
  };

  const handleStop = async () => {
    if (!submissionId || stopping) return;
    setStopping(true);
    try {
      const res = await fetch(`/api/runs/${submissionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${user?.token}` },
      });
      if (res.ok) {
        clearInterval(pollRef.current!);
        setStatus('stopped');
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Failed to stop submission');
      }
    } catch {
      setError('Network error while stopping submission');
    } finally {
      setStopping(false);
    }
  };

  const handleReset = () => {
    clearInterval(pollRef.current!);
    setSubmissionId(null);
    setStatus(null);
    setFile(null);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) { setError('Please select a file first'); return; }
    setError('');
    setSubmitting(true);
    setStatus('queued');

    const form = new FormData();
    form.append('file', file);
    form.append('language', language);

    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${user?.token}` },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Submission failed');
      }
      const data = await res.json();
      setSubmissionId(data.submissionId);
      setStatus('building');
      startPolling(data.submissionId);
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    } finally {
      setSubmitting(false);
    }
  };

  const currentStep = status ? statusToStep(status) : -1;
  const isLive    = status === 'running';
  const isError   = status === 'error';
  const isStopped = status === 'stopped';

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <div className="page-header__title">Submit Your Solution</div>
          <div className="page-header__sub">Upload your trading engine source code to compete</div>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* Error banner */}
        {error && (
          <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(255,71,87,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--red)', marginBottom: 20, fontSize: '0.875rem' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Step 1 — Language */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__header">
            <span className="card__title">Step 1 — Select Language</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {LANGUAGES.map(lang => (
              <button
                key={lang.key}
                onClick={() => setLanguage(lang.key)}
                style={{
                  background: language === lang.key ? 'var(--accent-dim)' : 'var(--elevated)',
                  border: `1px solid ${language === lang.key ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 10, padding: '16px',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'all 200ms',
                }}
              >
                <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>{lang.icon}</div>
                <div style={{ fontWeight: 700, color: language === lang.key ? 'var(--accent)' : 'var(--text)', marginBottom: 2 }}>{lang.label}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{lang.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Step 2 — File Upload */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__header">
            <span className="card__title">Step 2 — Upload Source Code</span>
          </div>

          {!file ? (
            <div
              className={`dropzone${dragging ? ' dropzone--active' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <div className="dropzone__icon">📦</div>
              <div className="dropzone__title">Drop your archive here</div>
              <div className="dropzone__sub">Accepts .zip or .tar.gz · Max 50MB</div>
              <input ref={fileRef} type="file" accept=".zip,.tar.gz" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', background: 'var(--elevated)', borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '2rem' }}>📦</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{file.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{(file.size / 1024).toFixed(1)} KB</div>
              </div>
              <button className="btn btn--ghost" onClick={() => setFile(null)} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                Remove
              </button>
            </div>
          )}
        </div>

        {/* Step 3 — Submit */}
        {!submissionId && (
          <form onSubmit={handleSubmit}>
            <button
              type="submit"
              className="btn btn--primary btn--full btn--lg"
              disabled={submitting || !file}
            >
              {submitting ? '⏳ Uploading...' : '🚀 Deploy to Sandbox'}
            </button>
          </form>
        )}

        {/* Progress tracker */}
        {submissionId && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card__header">
              <span className="card__title">Deployment Progress</span>
              <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                {submissionId.slice(0, 8)}…
              </span>
            </div>

            <div className="progress-steps">
              {STEPS.map((step, i) => {
                const done = currentStep > i || isLive;
                const active = currentStep === i && !isLive;
                const cls = done ? 'step step--done' : active ? 'step step--active' : 'step';
                return (
                  <div key={step} className={cls} style={{ flex: 1 }}>
                    {i > 0 && <div className="step__line" />}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <div className="step__dot">{done ? '✓' : i + 1}</div>
                      <div className="step__label">{step}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {isLive && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>🎉</div>
                <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 4 }}>Your submission is LIVE!</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: 16 }}>Bots are firing orders at your engine right now</div>

                {/* Live metric hint */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
                  {['Bots: 20 active', 'Rate: ~300 orders/sec', 'Duration: max 10 min'].map(hint => (
                    <span key={hint} style={{ fontSize: '0.75rem', padding: '4px 10px', background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 20, color: 'var(--muted)' }}>
                      {hint}
                    </span>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <a href="/leaderboard" className="btn btn--primary">View Leaderboard →</a>
                  <a href="/my-analytics" className="btn btn--ghost">My Analytics</a>
                  <button
                    className="btn"
                    onClick={handleStop}
                    disabled={stopping}
                    style={{ background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)' }}
                  >
                    {stopping ? '⏳ Stopping...' : '🛑 Stop Submission'}
                  </button>
                </div>
              </div>
            )}

            {isStopped && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>🛑</div>
                <div style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Submission Stopped</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: 16 }}>Container has been cleaned up. Final scores are preserved in the leaderboard.</div>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                  <a href="/leaderboard" className="btn btn--ghost">View Final Score →</a>
                  <button className="btn btn--primary" onClick={handleReset}>Submit New Version</button>
                </div>
              </div>
            )}

            {isError && (
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--red)' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>❌</div>
                <div style={{ fontWeight: 700 }}>Deployment failed</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: 4, marginBottom: 16 }}>Check your code builds correctly for {language}. Common issues: missing <code>GET /health</code> endpoint, port not 8080, or compilation error.</div>
                <button className="btn btn--primary" onClick={handleReset}>Try Again</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
