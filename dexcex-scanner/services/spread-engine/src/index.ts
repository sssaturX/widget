/**
 * Spread Engine — calculates spreads between DEX and CEX
 * Consumes: dex.liquidity, cex.prices, risk.results
 * Publishes: spreads.calculated
 * Slippage: estimated from trade size vs liquidity (constant-product AMM)
 */
import { connect } from "nats";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://localhost:8089";
const RISK_THRESHOLD = Number(process.env.RISK_THRESHOLD) || 50;
const SLIPPAGE_TRADE_USD = Number(process.env.SLIPPAGE_TRADE_USD) || 1000;
const HEALTH_PORT = Number(process.env.HEALTH_PORT) || 8086;
const CEX_EXCHANGES = (process.env.CEX_EXCHANGES ?? "binance,mexc,gate,bybit,kucoin,okx").split(",").map((s) => s.trim());

const encoder = new TextEncoder();
const cexPrices = new Map<string, { price: number; ts: number }>();
const dexPrices = new Map<string, { price: number; liquidity: number; protocol?: string; reserve0?: number; reserve1?: number; ts: number }>();
const TOKEN_MAP = new Map<string, string>();
const riskScores = new Map<string, { score: number; ts: number }>();
const RISK_STALE_MS = 600_000;

function dexKey(chain: string, token: string): string {
  return `${chain}:${token.toLowerCase()}`;
}

function cexKey(exchange: string, symbol: string): string {
  return `${exchange}:${symbol.toUpperCase()}`;
}

function toCexSymbol(token: string): string {
  const hex = token.replace(/^0x/, "").toUpperCase();
  return hex ? hex.slice(0, 10) + "USDT" : "UNKNOWNUSDT";
}

/** Estimate slippage % for a trade of tradeUsd on pool with liquidityUsd (constant-product approx) */
function slippagePct(tradeUsd: number, liquidityUsd: number): number {
  if (liquidityUsd <= 0) return 5;
  const ratio = tradeUsd / Math.max(liquidityUsd, 100);
  return Math.min(5, 50 * ratio);
}

async function fetchRegistryMappings(): Promise<void> {
  try {
    const res = await fetch(`${REGISTRY_URL}/api/registry/bulk`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const data = await res.json();
    const mappings = data.mappings ?? data;
    for (const [k, symbol] of Object.entries(mappings)) {
      if (typeof symbol === "string") TOKEN_MAP.set(String(k), symbol);
    }
  } catch {
    /* ignore */
  }
}

async function main() {
  const nc = await connect({ servers: NATS_URL });
  const publish = (subject: string, data: Uint8Array) => { nc.publish(subject, data); };

  await fetchRegistryMappings();
  setInterval(fetchRegistryMappings, 60_000);

  const subCex = nc.subscribe("cex.prices");
  (async () => {
    for await (const msg of subCex) {
      try {
        const d = JSON.parse(msg.data.toString());
        const key = cexKey(d.exchange, d.symbol);
        const price = Number(d.last ?? d.bid ?? d.ask);
        if (Number.isFinite(price) && price > 0) {
          cexPrices.set(key, { price, ts: d.ts ?? Date.now() });
        }
      } catch {
        /* ignore */
      }
    }
  })().catch(() => {});

  const subDex = nc.subscribe("dex.liquidity");
  (async () => {
    for await (const msg of subDex) {
      try {
        const d = JSON.parse(msg.data.toString());
        const key = dexKey(d.chain, d.token ?? d.pool);
        const price = Number(d.price);
        const liq = Number(d.tvl_usd ?? d.liquidity_usd ?? 0);
        const r0 = Number(d.reserve0);
        const r1 = Number(d.reserve1);
        if (Number.isFinite(price) && price > 0) {
          dexPrices.set(key, {
            price,
            liquidity: liq,
            protocol: d.protocol ?? "uniswap_v2",
            reserve0: Number.isFinite(r0) ? r0 : undefined,
            reserve1: Number.isFinite(r1) ? r1 : undefined,
            ts: d.ts ?? Date.now(),
          });
        }
      } catch {
        /* ignore */
      }
    }
  })().catch(() => {});

  const subRisk = nc.subscribe("risk.results");
  (async () => {
    for await (const msg of subRisk) {
      try {
        const d = JSON.parse(msg.data.toString());
        const key = dexKey(d.chain ?? "ethereum", d.address ?? "");
        if (!key.endsWith(":0x")) {
          riskScores.set(key, { score: Number(d.risk_score) ?? 100, ts: d.ts ?? Date.now() });
        }
      } catch {
        /* ignore */
      }
    }
  })().catch(() => {});

  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cexPrices) {
      if (now - v.ts > 60_000) cexPrices.delete(k);
    }
    for (const [k, v] of dexPrices) {
      if (now - v.ts > 120_000) dexPrices.delete(k);
    }
    for (const [k, v] of riskScores) {
      if (now - v.ts > RISK_STALE_MS) riskScores.delete(k);
    }
  }, 30_000);

  setInterval(() => {
    const now = Date.now();
    for (const [dk, dv] of dexPrices) {
      const [chain, token] = dk.split(":");
      const risk = riskScores.get(dk);
      if (risk && risk.score >= RISK_THRESHOLD && now - risk.ts < RISK_STALE_MS) continue;
      const cexSym = TOKEN_MAP.get(dk) ?? toCexSymbol(token);
      for (const ex of CEX_EXCHANGES) {
        const ck = cexKey(ex, cexSym);
        const cv = cexPrices.get(ck);
        if (!cv || now - cv.ts > 30_000) continue;
        const rawSpreadPct = ((dv.price - cv.price) / cv.price) * 100;
        if (Math.abs(rawSpreadPct) < 0.01) continue;
        const slip = slippagePct(SLIPPAGE_TRADE_USD, dv.liquidity);
        const spreadPct = rawSpreadPct > 0 ? rawSpreadPct - slip : rawSpreadPct + slip;
        if (Math.abs(spreadPct) < 0.01) continue;
        const payload = JSON.stringify({
          chain,
          token,
          dex_protocol: dv.protocol ?? "uniswap_v2",
          dex_price: dv.price,
          cex_exchange: ex,
          cex_price: cv.price,
          spread_pct: Math.round(spreadPct * 10000) / 10000,
          slippage_pct: slip,
          liquidity_usd: dv.liquidity,
          risk_score: risk?.score ?? null,
          ts: now,
        });
        publish("spreads.calculated", encoder.encode(payload));
      }
    }
  }, 500);

  const healthServer = await import("node:http").then(({ createServer }) =>
    createServer((req, res) => {
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({ ok: true, service: "spread-engine", cexPrices: cexPrices.size, dexPrices: dexPrices.size })
        );
        return;
      }
      res.writeHead(404).end();
    })
  );
  healthServer.listen(HEALTH_PORT, () => console.log(`[spread-engine] Health on :${HEALTH_PORT}`));

  process.on("SIGTERM", () => {
    subCex.unsubscribe();
    subDex.unsubscribe();
    subRisk.unsubscribe();
    nc.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
