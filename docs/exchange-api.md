# IICPC Exchange API Contract

> **This document defines exactly what your trading engine must implement.**
> Bots will hammer your server the moment it passes the health check.
> Read every endpoint carefully — your score depends on it.

---

## How It Works

```
[You upload .zip] → [Sandbox builds Docker image] → [Container starts on :8080]
      ↓
[Bots send orders to POST /order] → [Your engine responds] → [Score computed]
```

Your container runs in a **fully isolated environment**:
- No internet access
- 512 MB RAM hard cap (OOM = instant kill = score 0)
- 1 vCPU max
- Read-only filesystem (no disk writes at runtime)
- Max **10 minutes** per submission, then auto-stopped

---

## Required Endpoints

Your HTTP server **must** listen on port `8080`.

---

### `GET /health`
**Purpose:** Sandbox polls this every 500ms to know your server is ready. Bots don't start until this returns 200.

**Request:** No body, no headers.

**Response:**
```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "ok"
}
```

> **Warning:** If `/health` doesn't return 200 within 30 seconds of container start, your submission is marked as `error` and gets score 0.

---

### `POST /order`
**Purpose:** The primary endpoint. Bots send up to ~300 orders/sec here. This is what's scored.

**Request Headers:**
```
Content-Type: application/json
```

**Request Body — Three possible shapes:**

#### 1. LIMIT Order (60% of traffic)
```json
{
  "orderId": "ord-1716636000000-abc12",
  "type": "LIMIT",
  "side": "buy",
  "price": 1023.45,
  "quantity": 42
}
```

| Field | Type | Description |
|---|---|---|
| `orderId` | `string` | Unique order identifier. Use as your primary key. |
| `type` | `"LIMIT"` | Fixed string |
| `side` | `"buy" \| "sell"` | Direction of the order |
| `price` | `number` | Limit price. Always within ±5% of 1000 (i.e., 950–1050) |
| `quantity` | `number` | Integer 1–100 |

#### 2. MARKET Order (25% of traffic)
```json
{
  "orderId": "ord-1716636000001-def34",
  "type": "MARKET",
  "side": "sell",
  "quantity": 17
}
```

| Field | Type | Description |
|---|---|---|
| `orderId` | `string` | Unique order identifier |
| `type` | `"MARKET"` | Fixed string |
| `side` | `"buy" \| "sell"` | Direction |
| `quantity` | `number` | Integer 1–50. Must be filled at best available price. |

> **Correctness note:** MARKET orders are how correctness is measured. Fill the correct quantity at the best available price.

#### 3. CANCEL Order (15% of traffic)
```json
{
  "orderId": "ord-1716636000002-ghi56",
  "type": "CANCEL",
  "cancelOrderId": "ord-1716636000000-abc12"
}
```

| Field | Type | Description |
|---|---|---|
| `orderId` | `string` | ID of this cancel request |
| `type` | `"CANCEL"` | Fixed string |
| `cancelOrderId` | `string` | The `orderId` of the order to cancel. May refer to already-filled or non-existent orders. |

---

**Expected Response (for ALL order types):**
```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "orderId": "ord-1716636000001-def34",
  "status": "filled",
  "filledQty": 17
}
```

| Field | Type | Description |
|---|---|---|
| `orderId` | `string` | Echo back the orderId from the request |
| `status` | `string` | `"filled"` \| `"partial"` \| `"queued"` \| `"cancelled"` \| `"rejected"` |
| `filledQty` | `number` | How many units were actually filled. `0` for limit orders resting in the book, full quantity for market orders, etc. |

> **Any 2xx response** is accepted as "acknowledged" for latency timing. The bot measures the round-trip time from sending the request to receiving any 2xx response.

> **Non-2xx or timeout** = failed order. Does not count toward TPS, hurts your circuit breaker, and counts as a missed order for correctness.

---

## Scoring Formula

```
compositeScore = (40% × latencyScore) + (40% × throughputScore) + (20% × correctnessScore)
```

All scores are **normalized across all active submissions** during each 1-second flush:
- If you're the only submission, you get 50/100 on latency and throughput.
- With multiple submissions, you're ranked relative to each other.

### Latency Score (40%)
- Measured as **p99 round-trip time** in milliseconds
- Lower is better
- Target: < 1ms p99 for maximum score

```
latencyScore = 100 - normalize(your_p99, all_p99_values)
```

### Throughput Score (40%)  
- Measured as **orders successfully acknowledged per second (TPS)**
- Higher is better
- 20 bots × 15 orders/sec each = up to **300 orders/sec** hitting your server

```
throughputScore = normalize(your_tps, all_tps_values)
```

### Correctness Score (20%)
- Only **MARKET orders** are validated
- Your exchange must fill the correct quantity at the best available price
- Formula: `(correct fills / total market orders) × 100`
- Fewer than 10 market orders seen → score = 100 (insufficient sample)

```
correctnessScore = (correct_market_fills / total_market_orders) × 100
```

---

## What a Correct Exchange Must Do

### Order Book
- Maintain a **price-time priority order book** (limit order book / LOB)
- LIMIT buy orders: sorted descending by price (highest bid first)
- LIMIT sell orders: sorted ascending by price (lowest ask first)

### LIMIT Order Handling
1. Try to match immediately against existing opposite-side orders
2. If partial match: fill what you can, rest the remainder in the book
3. If no match: rest the entire order in the book
4. Return `status: "queued"` if resting, `status: "filled"` or `"partial"` if matched

### MARKET Order Handling
1. Walk the opposite side of the book, filling at each price level
2. If the book has enough liquidity: fill the full quantity → `status: "filled"`, `filledQty: quantity`
3. If insufficient liquidity: fill what's available → `status: "partial"`, `filledQty: actual_filled`
4. Never rest in the book — market orders always execute immediately or partially

### CANCEL Order Handling
1. Remove the order from the book if it exists and is not yet filled
2. If already filled or doesn't exist: return `status: "rejected"` (gracefully)
3. Return `status: "cancelled"` on success

---

## Code Structure Requirements

### C++ Submission
```
your-submission.zip
└── main.cpp            ← (or any .cpp/.cc/.cxx file)
```
- Compiles with: `g++ -O2 -o exchange main.cpp`
- Must bind to port `8080`

### Rust Submission
```
your-submission.zip
├── Cargo.toml
└── src/
    └── main.rs
```
- Compiles with: `cargo build --release`
- Your binary name (from Cargo.toml `[package] name`) becomes the executable

### Go Submission
```
your-submission.zip
├── go.mod
└── main.go             ← (or any .go files in root)
```
- Compiles with: `go build -o exchange .`
- Must bind to port `8080`

---

## Example Minimal Exchange (Go)

```go
package main

import (
    "encoding/json"
    "net/http"
)

type Order struct {
    OrderID       string  `json:"orderId"`
    Type          string  `json:"type"`
    Side          string  `json:"side,omitempty"`
    Price         float64 `json:"price,omitempty"`
    Quantity      int     `json:"quantity,omitempty"`
    CancelOrderID string  `json:"cancelOrderId,omitempty"`
}

type Response struct {
    OrderID   string `json:"orderId"`
    Status    string `json:"status"`
    FilledQty int    `json:"filledQty"`
}

func main() {
    // Health check — REQUIRED
    http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
    })

    // Order handler — REQUIRED
    http.HandleFunc("/order", func(w http.ResponseWriter, r *http.Request) {
        var order Order
        json.NewDecoder(r.Body).Decode(&order)

        // TODO: implement real order book matching
        resp := Response{
            OrderID:   order.OrderID,
            Status:    "filled",
            FilledQty: order.Quantity, // naive: always report full fill
        }
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(resp)
    })

    http.ListenAndServe(":8080", nil)
}
```

> **Note:** This naive implementation gets 100% correctness only if there's always liquidity. A real exchange needs a proper order book.

---

## Common Mistakes

| Mistake | Result |
|---|---|
| Missing `GET /health` | Submission marked `error`, score 0 |
| Listening on wrong port (not 8080) | Health check fails, score 0 |
| Responding with non-2xx on CANCEL of unknown order | Bot circuit breaker opens, TPS drops |
| Crashing on OOM | Container killed by Docker, all bots get circuit-breaker errors |
| Blocking on disk writes | High p99 latency, low throughput score |
| Not handling concurrent requests | All bots queue up, p99 spikes |

---

## Bot Traffic Profile

```
20 bots × Poisson(λ=15 orders/sec each) = ~300 orders/sec total load

Order type distribution:
  60% LIMIT   → price within ±5% of 1000
  25% MARKET  → quantity 1–50
  15% CANCEL  → references recent order IDs

Max submission duration: 10 minutes (auto-stopped)
Memory limit: 512 MB
CPU limit: 1 vCPU
```

---

## Testing Locally Before Submitting

```bash
# Start your server
./exchange &

# Health check
curl http://localhost:8080/health
# Expected: {"status":"ok"}

# Send a LIMIT order
curl -X POST http://localhost:8080/order \
  -H "Content-Type: application/json" \
  -d '{"orderId":"test-1","type":"LIMIT","side":"buy","price":1000,"quantity":10}'
# Expected: {"orderId":"test-1","status":"queued","filledQty":0}

# Send a MARKET order
curl -X POST http://localhost:8080/order \
  -H "Content-Type: application/json" \
  -d '{"orderId":"test-2","type":"MARKET","side":"sell","quantity":5}'
# Expected: {"orderId":"test-2","status":"filled","filledQty":5}

# Cancel an order
curl -X POST http://localhost:8080/order \
  -H "Content-Type: application/json" \
  -d '{"orderId":"test-3","type":"CANCEL","cancelOrderId":"test-1"}'
# Expected: {"orderId":"test-3","status":"cancelled","filledQty":0}
```

---

*Last updated: 2026-05-25 · IICPC Platform*
