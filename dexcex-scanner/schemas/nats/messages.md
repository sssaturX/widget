# NATS Message Schemas

## tokens.new
```json
{
  "chain": "ethereum",
  "address": "0x...",
  "symbol": "TOKEN",
  "name": "Token Name",
  "decimals": 18,
  "ts": 1709820000000
}
```

## dex.events
```json
{
  "chain": "ethereum",
  "protocol": "uniswap_v2",
  "event": "Swap",
  "pool": "0x...",
  "token0": "0x...",
  "token1": "0x...",
  "amount0": "1000000",
  "amount1": "500",
  "tx": "0x...",
  "block": 12345678,
  "ts": 1709820000000
}
```

## dex.liquidity
```json
{
  "chain": "ethereum",
  "protocol": "uniswap_v2",
  "pool": "0x...",
  "reserve0": "1000000000000000000",
  "reserve1": "500000000000",
  "tvl_usd": 125000.50,
  "ts": 1709820000000
}
```

## cex.prices
```json
{
  "exchange": "binance",
  "symbol": "TOKENUSDT",
  "bid": 0.1234,
  "ask": 0.1235,
  "last": 0.12345,
  "ts": 1709820000000
}
```

## risk.results
```json
{
  "chain": "ethereum",
  "address": "0x...",
  "passed": false,
  "is_honeypot": true,
  "sell_tax_pct": 15,
  "flags": ["high_tax", "owner_controls_lp"],
  "ts": 1709820000000
}
```

## spreads.calculated
```json
{
  "chain": "ethereum",
  "token": "0x...",
  "dex_protocol": "uniswap_v2",
  "dex_price": 0.123,
  "cex_exchange": "binance",
  "cex_price": 0.120,
  "spread_pct": 2.5,
  "liquidity_usd": 50000,
  "ts": 1709820000000
}
```

## signals.generated
```json
{
  "id": "uuid",
  "chain": "ethereum",
  "token": "0x...",
  "action": "buy_dex_sell_cex",
  "spread_pct": 2.5,
  "profit_est_usd": 125.50,
  "liquidity_usd": 50000,
  "dex_protocol": "uniswap_v2",
  "cex_exchange": "binance",
  "ts": 1709820000000
}
```
