// Core Domain Types for IICPC Platform

export interface Submission {
    id: string;
    userId: string;
    problemId: string;
    language: 'cpp' | 'python' | 'java' | 'rust';
    code: string;                    // base64 encoded or raw source
    submittedAt: Date;
    status: 'pending' | 'running' | 'completed' | 'failed';
    executionTimeMs?: number;
    memoryUsedKb?: number;
    correctnessRate: number;         // 0-100 (percentage of test cases passed)
  }
  
  export interface TelemetryEvent {
    submissionId: string;
    timestamp: Date;
    eventType: 'container_start' | 'execution_start' | 'execution_end' | 'container_stop';
    latencyMs: number;
    memoryUsageMb: number;
    cpuUsagePercent: number;
    metadata?: Record<string, any>;
  }
  
  export interface LiveScore {
    submissionId: string;
    userId: string;
    problemId: string;
    score: number;                   // composite score (0-100)
    correctnessRate: number;
    latencyP50: number;              // percentile latencies
    latencyP90: number;
    latencyP99: number;
    updatedAt: Date;
  }
  
  export interface SubmissionReadyEvent {
    submissionId: string;
    submission: Submission;
    timestamp: Date;
  }
  
  export interface SubmissionStoppedEvent {
    submissionId: string;
    reason: 'completed' | 'timeout' | 'error' | 'manual_stop';
    finalScore?: LiveScore;
    timestamp: Date;
  }
  
