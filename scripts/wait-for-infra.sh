#!/bin/bash

set -e

echo "⏳ Waiting for infrastructure to be healthy..."

# Wait for Redpanda
until docker exec iicpc-redpanda rpk cluster info > /dev/null 2>&1; do
  sleep 1
done

echo "✅ Redpanda healthy"

# Wait for TimescaleDB
until docker exec iicpc-timescale pg_isready -U postgres > /dev/null 2>&1; do
  sleep 1
done

echo "✅ Timescale healthy"

# Wait for Redis
until docker exec iicpc-redis redis-cli ping | grep PONG > /dev/null 2>&1; do
  sleep 1
done

echo "✅ Redis healthy"

# Wait for MinIO
until curl -sf http://localhost:9000/minio/health/live > /dev/null 2>&1; do
  sleep 1
done

echo "✅ MinIO healthy"

echo "🚀 All infrastructure services are healthy!"