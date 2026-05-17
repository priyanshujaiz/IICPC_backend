CREATE TABLE "metrics" (
	"time" timestamp with time zone NOT NULL,
	"submission_id" text NOT NULL,
	"latency_p50" real DEFAULT 0 NOT NULL,
	"latency_p90" real DEFAULT 0 NOT NULL,
	"latency_p99" real DEFAULT 0 NOT NULL,
	"tps" real DEFAULT 0 NOT NULL,
	"correctness_rate" real DEFAULT 0 NOT NULL,
	"composite_score" real DEFAULT 0 NOT NULL,
	"total_orders" bigint DEFAULT 0 NOT NULL,
	"correct_fills" bigint DEFAULT 0 NOT NULL,
	"total_fills" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"contestant_id" text NOT NULL,
	"language" text NOT NULL,
	"artifact_path" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"container_host" text,
	"container_port" integer,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone
);
