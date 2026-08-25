-- DEX-CEX Scanner — ClickHouse schema
-- Analytics: events, spreads, latency

CREATE TABLE IF NOT EXISTS dex_events (
  timestamp DateTime64(3),
  chain String,
  protocol String,
  event_type String,
  pool_address String,
  token0 String,
  token1 String,
  amount0 Float64,
  amount1 Float64,
  tx_hash String,
  block_number UInt64
) ENGINE = MergeTree()
ORDER BY (chain, protocol, timestamp)
TTL timestamp + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS cex_ticks (
  timestamp DateTime64(3),
  exchange String,
  symbol String,
  bid Float64,
  ask Float64,
  last Float64,
  volume Float64
) ENGINE = MergeTree()
ORDER BY (exchange, symbol, timestamp)
TTL timestamp + INTERVAL 7 DAY;

CREATE TABLE IF NOT EXISTS spread_events (
  timestamp DateTime64(3),
  chain String,
  token_address String,
  dex_protocol String,
  cex_exchange String,
  spread_pct Float64,
  dex_price Float64,
  cex_price Float64,
  liquidity_usd Float64,
  latency_ms UInt32
) ENGINE = MergeTree()
ORDER BY (chain, cex_exchange, timestamp)
TTL timestamp + INTERVAL 90 DAY;

CREATE TABLE IF NOT EXISTS signal_events (
  timestamp DateTime64(3),
  signal_id UUID,
  chain String,
  token_address String,
  action String,
  spread_pct Float64,
  profit_est Float64,
  latency_ms UInt32
) ENGINE = MergeTree()
ORDER BY (timestamp)
TTL timestamp + INTERVAL 90 DAY;
