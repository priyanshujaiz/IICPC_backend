// Types aligned to the three-store architecture: TimescaleDB · Redis · MinIO

//  TimescaleDB: submissions table 

export interface Submission {
  id: string;                                                    // UUID v4
  contestantId: string;                                          // from JWT sub claim
  language: 'cpp' | 'rust' | 'go';
  artifactPath: string;                                          // MinIO key: {id}/{filename}
  status: 'queued' | 'building' | 'running' | 'stopped' | 'error';
  containerHost?: string;                                        // set after container starts
  containerPort?: number;                                        // set after container starts
  submittedAt: number;                                           // epoch ms
  startedAt?: number;                                            // epoch ms
  stoppedAt?: number;                                            // epoch ms
}

// ─── TimescaleDB: metrics hypertable (1 row per second per submission) 

export interface MetricSnapshot {
  time: number;                                                  // epoch ms (hypertable key)
  submissionId: string;
  latencyP50: number;                                            // ms
  latencyP90: number;                                            // ms
  latencyP99: number;                                            // ms
  tps: number;                                                   // orders per second
  correctnessRate: number;                                       // 0–100
  compositeScore: number;                                        // 0–100
  totalOrders: number;                                           // cumulative
  correctFills: number;                                          // cumulative
  totalFills: number;                                            // cumulative
}

// ─── Redis: leaderboard sorted set + score snapshot

export interface LiveScore {
  submissionId: string;
  latencyP50: number;
  latencyP90: number;
  latencyP99: number;
  tps: number;
  correctnessRate: number;
  compositeScore: number;                                        // score in the sorted set
}

// ─── Kafka: submission.ready topic (sandbox → bot-fleet)

export interface SubmissionReadyEvent {
  submissionId: string;
  host: string;                                                  // container reachable host
  port: number;                                                  // container exposed port
}

// ─── Kafka: submission.stopped topic (gateway → bot-fleet)

export interface SubmissionStoppedEvent {
  submissionId: string;
  reason: 'manual_stop' | 'timeout' | 'error';
}

// ─── Bot worker → Telemetry Ingester (HTTP POST /events/batch) 

export interface TelemetryEvent {
  submissionId: string;
  orderId: string;
  sentAt: number;                                                
  ackedAt: number;                                               // performance.now() ms
  orderType: 'LIMIT' | 'MARKET' | 'CANCEL';
  filled: number;                                                // actual fill qty from exchange
  expectedFill: number;                                          // reference engine fill qty
}

