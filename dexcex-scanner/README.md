# DEX-CEX Scanner

[![License: MIT](https://img.shields.io/badge/License-MIT-6f42c1.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-3c873a.svg)](https://nodejs.org/)
[![NATS](https://img.shields.io/badge/NATS-core-27AAE1.svg)](https://nats.io/)

Open-source **DEX vs CEX** spread scanner. It streams on-chain / aggregator DEX prices, public CEX futures tickers, scores basic token risk, and publishes arbitrage **signals**. It does **not** place orders.

Extracted from [Farm Terminal](https://github.com/sssaturX/farm) and released under MIT.

> Not financial advice. Spreads can be stale, unexecutable, or eaten by fees and slippage. You can lose money.

## What it does

```
DEX prices                          CEX prices
  DeFiLlama / custom REST             Binance, MEXC, Gate,
  or optional RPC indexer             Bybit, KuCoin, OKX
        \                               /
         \                             /
          +------ NATS (core) --------+
                    |
         token-registry   risk-engine
                    |
              spread-engine
                    |
              signal-engine
                    |
              REST API :3002
```

| Service | Default port | Role |
| --- | --- | --- |
| dex-price-aggregator | 8092 | DEX prices without RPC (DeFiLlama or `AGGREGATOR_URL`) |
| rpc-gateway | 8545 / 8546 | Optional RPC proxy with per-chain failover |
| dex-indexer | 8088 | Optional Uniswap V2–style `eth_getLogs` indexer |
| token-registry | 8089 | Contract → CEX symbol map |
| risk-engine | 8090 | `eth_getCode` / no-contract filter |
| cex-market-engine | 8085 | Public CEX websocket tickers |
| spread-engine | 8086 | DEX−CEX spread + AMM slippage estimate |
| signal-engine | 8087 | Thresholds, top-N per chain |
| dexcex-api | 3002 | `GET /api/signals`, `/health`, `/metrics` |

Chains on the aggregator feed: Ethereum, BSC, Arbitrum, Polygon, Base, Optimism, Avalanche, Fantom, Linea, Mantle, Scroll, Solana.

RPC indexer (optional): Uniswap V2, Sushiswap, PancakeSwap V2, Aerodrome.

## Quick start

```bash
git clone https://github.com/sssaturX/dexcex-scanner.git
cd dexcex-scanner
cp .env.example .env
docker compose up -d --build
```

API: [http://127.0.0.1:3002/health](http://127.0.0.1:3002/health)  
Signals: [http://127.0.0.1:3002/api/signals?limit=20](http://127.0.0.1:3002/api/signals?limit=20)

Default DEX feed is **DeFiLlama** (no RPC keys). Enable the log indexer with:

```bash
docker compose --profile rpc up -d --build
```

Then set keyed RPCs in `.env` (`RPC_ETHEREUM=...`). Public RPCs often return 403/HTML from datacenters.

### Local Node (infra in Docker)

```bash
docker compose up -d dexcex-postgres dexcex-redis dexcex-nats
cp .env.example .env
# point NATS_URL at localhost:4223 (compose publishes 4223)
NATS_URL=nats://127.0.0.1:4223 AGGREGATOR_TYPE=defillama npm install
npm run dev:standalone
```

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Process + NATS |
| GET | `/api/signals?limit=50` | Recent signals (max 200) |
| GET | `/api/dexcex/status` | Buffer counts |
| GET | `/metrics` | Prometheus text |

Signal payload (NATS `signals.generated`):

```json
{
  "id": "uuid",
  "chain": "ethereum",
  "token": "0x...",
  "action": "buy_dex_sell_cex",
  "spread_pct": 1.25,
  "profit_est_usd": 12.5,
  "liquidity_usd": 1000,
  "dex_protocol": "defillama",
  "cex_exchange": "binance",
  "risk_score": null,
  "ts": 1709820000000
}
```

## Configuration

See [`.env.example`](.env.example) and [docs/DEXCEX-DEPLOYMENT.md](docs/DEXCEX-DEPLOYMENT.md).

| Variable | Default | Meaning |
| --- | --- | --- |
| `NATS_URL` | `nats://localhost:4222` | Core NATS (not JetStream) |
| `DEX_AGGREGATOR_TYPE` | `defillama` | `defillama` or generic REST |
| `MIN_SPREAD_PCT` | `0.5` | Absolute % after slippage |
| `MIN_LIQUIDITY_USD` | `100` | Skip thin pools |
| `CORS_ORIGINS` | unset (allow all) | Comma-separated allowlist |

## Docs

- [Architecture](docs/DEXCEX-ARCHITECTURE.md)
- [Deployment](docs/DEXCEX-DEPLOYMENT.md)
- [NATS message schemas](schemas/nats/messages.md)
- [Security](SECURITY.md)

## License

[MIT](LICENSE) © SaturX

Farm Terminal itself remains [All Rights Reserved](https://github.com/sssaturX/farm/blob/main/LICENSE). This scanner is the MIT extract.
