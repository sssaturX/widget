/**
 * Signal Engine — generates arbitrage alerts
 * Consumes: spreads.calculated
 * Publishes: signals.generated
 * Filters: min spread %, liquidity, risk_score
 * Optional: Top N spreads per chain (TOP_N_PER_CHAIN=10)
 */
import { connect } from "nats";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const MIN_SPREAD_PCT = Number(process.env.MIN_SPREAD_PCT) || 1;
const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD) || 1000;
const TOP_N_PER_CHAIN = Number(process.env.TOP_N_PER_CHAIN) || 0;
const MAX_RISK_SCORE = Number(process.env.MAX_RISK_SCORE) || 50;
const HEALTH_PORT = Number(process.env.HEALTH_PORT) || 8087;

const encoder = new TextEncoder();
const signals: Array<{ id: string; ts: number; payload: unknown }> = [];
const MAX_SIGNALS = 1000;

/** Per-chain top N by |spread_pct|, keyed by chain */
const topByChain = new Map<string, Array<{ key: string; spreadPct: number }>>();

function rankKey(d: { chain: string; token: string; cex_exchange: string }): string {
  return `${d.chain}:${(d.token ?? "").toLowerCase()}:${d.cex_exchange}`;
}

/** Returns true if spread is in top N for chain; updates the ranking. */
function updateAndCheckTopN(chain: string, spreadPct: number, key: string): boolean {
  if (TOP_N_PER_CHAIN <= 0) return true;
  const list = topByChain.get(chain) ?? [];
  const absSpread = Math.abs(spreadPct);
  const filtered = list.filter((x) => x.key !== key);
  const next = [...filtered, { key, spreadPct: absSpread }].sort((a, b) => b.spreadPct - a.spreadPct).slice(0, TOP_N_PER_CHAIN);
  topByChain.set(chain, next);
  return next.some((x) => x.key === key);
}

async function main() {
  const nc = await connect({ servers: NATS_URL });
  const publish = (subject: string, data: Uint8Array) => { nc.publish(subject, data); };

  const sub = nc.subscribe("spreads.calculated");
  (async () => {
    for await (const msg of sub) {
      try {
        const d = JSON.parse(msg.data.toString());
        const spreadPct = Number(d.spread_pct);
        const liquidity = Number(d.liquidity_usd ?? 0);
        const riskScore = Number(d.risk_score);
        if (!Number.isFinite(spreadPct) || Math.abs(spreadPct) < MIN_SPREAD_PCT) continue;
        if (liquidity < MIN_LIQUIDITY_USD) continue;
        if (Number.isFinite(riskScore) && riskScore >= MAX_RISK_SCORE) continue;

        const key = rankKey(d);
        if (!updateAndCheckTopN(d.chain ?? "ethereum", spreadPct, key)) continue;

        const id = crypto.randomUUID();
        const action = spreadPct > 0 ? "buy_dex_sell_cex" : "buy_cex_sell_dex";
        const profitEst = Math.abs(spreadPct) * liquidity * 0.01;
        const payload = {
          id,
          chain: d.chain,
          token: d.token,
          action,
          spread_pct: spreadPct,
          profit_est_usd: Math.round(profitEst * 100) / 100,
          liquidity_usd: liquidity,
          dex_protocol: d.dex_protocol,
          cex_exchange: d.cex_exchange,
          risk_score: Number.isFinite(riskScore) ? riskScore : null,
          ts: Date.now(),
        };
        signals.unshift({ id, ts: payload.ts, payload });
        if (signals.length > MAX_SIGNALS) signals.pop();
        publish("signals.generated", encoder.encode(JSON.stringify(payload)));
      } catch {
        /* ignore */
      }
    }
  })().catch(() => {});

  const healthServer = await import("node:http").then(({ createServer }) =>
    createServer((req, res) => {
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({ ok: true, service: "signal-engine", signalsCount: signals.length, topNPerChain: TOP_N_PER_CHAIN })
        );
        return;
      }
      res.writeHead(404).end();
    })
  );
  healthServer.listen(HEALTH_PORT, () => console.log(`[signal-engine] Health on :${HEALTH_PORT}`));

  process.on("SIGTERM", () => {
    sub.unsubscribe();
    nc.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
