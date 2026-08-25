# DEX-CEX Scanner — Deployment Guide

## Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local dev)

## Quick Start (Docker Compose)

```bash
docker compose up -d --build
```

Services:

- **dexcex-postgres** — 5434
- **dexcex-redis** — 6380
- **dexcex-nats** — 4223 (client), 8223 (monitoring)
- **dexcex-clickhouse** — 8124
- **rpc-gateway** — 8545
- **dex-indexer** — health 8088
- **token-registry** — health 8089
- **risk-engine** — health 8090
- **cex-market-engine** — health 8085
- **spread-engine** — health 8086
- **signal-engine** — health 8087
- **dexcex-api** — 3002

## Local Development

```bash
# Start infra only
docker compose up -d dexcex-postgres dexcex-redis dexcex-nats

# Run all services
npm run dev

# Or run subset
npm run dev:cex
npm run dev:spread
npm run dev:signal
npm run dev:api
```

## DEX prices: aggregators (default) vs RPC

By default, DEX prices are taken from **aggregators** (no RPC):

- **dexcex-price-aggregator** — polls DeFiLlama (`AGGREGATOR_TYPE=defillama`) or your `AGGREGATOR_URL` and publishes to `dex.liquidity`.
- **dexcex-indexer** (RPC-based) is **off by default**; enable with profile: `docker compose --profile rpc up -d dexcex-indexer`.

Variables for aggregator (in `.env` or compose):

- `DEX_AGGREGATOR_TYPE=defillama` — use DeFiLlama coins API (default).
- `DEX_AGGREGATOR_URL` — if set, GET this URL; expect JSON array of `{ chain, token, price, tvl_usd? }`.
- `DEX_AGGREGATOR_POLL_MS` — poll interval (default 15000).

To use RPC-based indexing instead, run with profile: `docker compose --profile rpc up -d` so that `dexcex-indexer` and its RPC dependency are started.

## RPC and dex-indexer (403 / HTML errors)

Public RPCs often block or rate-limit requests from datacenters. If the indexer logs **Upstream 403** or **RPC returned HTML**, set your own RPC URLs (with API keys) for the gateway.

In `.env` (see `.env.example`), add for the chains you need:

```env
# Optional: RPC URLs with API keys (used by dexcex-rpc-gateway). Comma-separated = fallbacks.
RPC_ETHEREUM=https://eth-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
RPC_BSC=https://bsc-dataseed.binance.org
RPC_ARBITRUM=https://arb-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
RPC_POLYGON=https://polygon-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
RPC_BASE=https://base-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
RPC_OPTIMISM=https://opt-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
RPC_AVALANCHE=https://api.avax.network/ext/bc/C/rpc
```

Then restart: `docker compose up -d dexcex-rpc-gateway dexcex-indexer`. Free tiers: [Alchemy](https://alchemy.com), [Infura](https://infura.io), [QuickNode](https://quicknode.com).

## Environment Variables

| Service | Key | Default |
|---------|-----|---------|
| All | NATS_URL | nats://localhost:4222 |
| **rpc-gateway** | RPC_ETHEREUM, RPC_BSC, … | (built-in public URLs) |
| dex-indexer | RPC_URL | http://dexcex-rpc-gateway:8545 (Docker) |
| dex-indexer | POLL_INTERVAL_MS | 4000 |
| dex-indexer | BATCH_SIZE | 2000 |
| spread-engine | REGISTRY_URL | http://localhost:8089 |
| spread-engine | RISK_THRESHOLD | 50 |
| spread-engine | CEX_EXCHANGES | binance,mexc,gate,bybit,kucoin,okx |
| signal-engine | MIN_SPREAD_PCT | 0.5 |
| signal-engine | MIN_LIQUIDITY_USD | 100 |
| signal-engine | TOP_N_PER_CHAIN | 10 |
| signal-engine | MAX_RISK_SCORE | 50 |
| cex-market-engine | EXCHANGES | binance,mexc,gate,bybit,kucoin,okx |

## API Endpoints

- `GET /health` — Health check
- `GET /api/signals` — Recent signals
- `GET /api/dexcex/signals` — Same
- `GET /api/dexcex/status` — System status
- `GET /metrics` — Prometheus metrics

## Kubernetes

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/
```

Build and push images for your registry, then update image references in manifests.
