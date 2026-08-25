-- DEX-CEX Scanner — PostgreSQL schema
-- Metadata: tokens, pools, registry, positions

-- Chains
CREATE TABLE IF NOT EXISTS chains (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rpc_urls TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tokens (discovered)
CREATE TABLE IF NOT EXISTS tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id TEXT NOT NULL REFERENCES chains(id),
  address TEXT NOT NULL,
  symbol TEXT,
  name TEXT,
  decimals INT NOT NULL DEFAULT 18,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chain_id, address)
);

CREATE INDEX idx_tokens_chain ON tokens(chain_id);
CREATE INDEX idx_tokens_symbol ON tokens(symbol) WHERE symbol IS NOT NULL;

-- Token registry (contract ↔ CEX symbol mapping)
CREATE TABLE IF NOT EXISTS token_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID REFERENCES tokens(id),
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  cex_symbol TEXT NOT NULL,
  cex_exchange TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chain_id, contract_address, cex_exchange)
);

CREATE INDEX idx_registry_cex ON token_registry(cex_exchange, cex_symbol);

-- DEX pools
CREATE TABLE IF NOT EXISTS dex_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id TEXT NOT NULL,
  protocol TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  token0_id UUID REFERENCES tokens(id),
  token1_id UUID REFERENCES tokens(id),
  reserve0 NUMERIC(78,0),
  reserve1 NUMERIC(78,0),
  block_number BIGINT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chain_id, protocol, pool_address)
);

CREATE INDEX idx_pools_chain_protocol ON dex_pools(chain_id, protocol);
CREATE INDEX idx_pools_token ON dex_pools(token0_id, token1_id);

-- Risk results (cached)
CREATE TABLE IF NOT EXISTS risk_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID REFERENCES tokens(id),
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  is_honeypot BOOLEAN DEFAULT FALSE,
  sell_tax_pct NUMERIC(5,2),
  flags JSONB,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_risk_token ON risk_results(chain_id, contract_address);

-- Arbitrage signals (generated)
CREATE TABLE IF NOT EXISTS arb_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID REFERENCES tokens(id),
  chain_id TEXT NOT NULL,
  dex_protocol TEXT NOT NULL,
  dex_pool_address TEXT NOT NULL,
  cex_exchange TEXT NOT NULL,
  spread_pct NUMERIC(10,4) NOT NULL,
  dex_price NUMERIC(36,18),
  cex_price NUMERIC(36,18),
  liquidity_usd NUMERIC(24,2),
  action TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_signals_created ON arb_signals(created_at DESC);
CREATE INDEX idx_signals_chain ON arb_signals(chain_id);

-- Positions (if execution enabled)
CREATE TABLE IF NOT EXISTS arb_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES arb_signals(id),
  status TEXT NOT NULL,
  entry_dex_tx TEXT,
  entry_cex_order_id TEXT,
  exit_dex_tx TEXT,
  exit_cex_order_id TEXT,
  pnl_usd NUMERIC(24,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
