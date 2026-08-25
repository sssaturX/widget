# DEX-CEX Arbitrage Scanner — Architecture

## Overview

Scanner for real-time spread opportunities between DEX and CEX markets across multiple blockchains. It publishes signals; it does not execute trades.

## Data Flow

```
DEX prices (choose one):
  • dex-price-aggregator (default) ──► dex.liquidity   [REST: DeFiLlama or AGGREGATOR_URL]
  • dex-indexer (profile: rpc)     ──► dex.events, dex.liquidity, tokens.new   [RPC: eth_getLogs]

     ├──► token-registry (maps contract → CEX symbol)
     │
     └──► risk-engine ──► risk.results
              │
cex-market-engine ──► cex.prices
              │
              ▼
        spread-engine ──► spreads.calculated
              │
              ▼
        signal-engine ──► signals.generated
              │
              ▼
        dexcex-api (REST, /metrics)
```

## Services

| Service | Consumes | Publishes | Purpose |
|---------|----------|-----------|---------|
| dex-price-aggregator | REST (DeFiLlama / AGGREGATOR_URL) | dex.liquidity | DEX prices without RPC (default) |
| dex-indexer | RPC (eth_getLogs) | dex.events, dex.liquidity, tokens.new | Index from chain (optional, profile `rpc`) |
| token-registry | tokens.new, dex.events | — | Map contract → CEX symbol, REST API |
| risk-engine | tokens.new, dex.events | risk.results | Filter honeypot, no-contract |
| cex-market-engine | WebSocket (CEX) | cex.prices | Live prices from Binance, MEXC, Gate, Bybit, Kucoin, OKX |
| spread-engine | dex.liquidity, cex.prices, risk.results | spreads.calculated | Compute spreads with slippage |
| signal-engine | spreads.calculated | signals.generated | Filter, Top N per chain |
| dexcex-api | signals.generated | — | REST API, /metrics |

## Event Topics

- `tokens.new` — New token discovered
- `dex.events` — PairCreated, Swap, Sync, Mint, Burn
- `dex.liquidity` — Pool reserves, price, tvl_usd
- `cex.prices` — Exchange ticker (exchange, symbol, bid, ask, last)
- `risk.results` — risk_score, passed, flags
- `spreads.calculated` — chain, token, spread_pct, liquidity_usd
- `signals.generated` — Arbitrage alerts

## Chains & DEX (all chains use aggregators for prices)

- **Chains (aggregator feed):** Ethereum, BSC, Arbitrum, Polygon, Base, Optimism, Avalanche, Fantom, Linea, Mantle, Scroll, Solana
- **DEX (when using RPC indexer):** Uniswap V2, Sushiswap, PancakeSwap V2, Aerodrome

## CEX

Binance, MEXC, Gate, Bybit, Kucoin, OKX (WebSocket + REST)

## Performance Targets

- Signal latency: <1s
- Spread calculation: <10ms
- Throughput: 100k+ events/sec
