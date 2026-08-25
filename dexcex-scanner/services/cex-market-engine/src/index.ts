/**
 * CEX Market Engine — Binance, MEXC, Gate, Bybit, Kucoin, OKX
 * Publishes: cex.prices
 */
import { connect } from "nats";
import { runBinance, runMexc, runGate, runBybit, runKucoin, runOkx, fetchSymbols } from "./connectors.js";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const EXCHANGES = (process.env.EXCHANGES ?? "binance,mexc,gate,bybit,kucoin,okx").split(",").map((s) => s.trim());
const HEALTH_PORT = Number(process.env.HEALTH_PORT) || 8085;

async function main() {
  const nc = await connect({ servers: NATS_URL });

  const publish = (topic: string, data: Uint8Array) => { nc.publish(topic, data); };
  const stops: (() => void)[] = [];

  if (EXCHANGES.includes("binance")) {
    stops.push(runBinance(publish));
  }

  for (const ex of ["mexc", "gate", "bybit", "kucoin", "okx"]) {
    if (!EXCHANGES.includes(ex)) continue;
    try {
      const symbols = await fetchSymbols(ex);
      if (symbols.length > 0) {
        const syms = symbols.length > 500 ? symbols.slice(0, 500) : symbols;
        if (ex === "mexc") stops.push(runMexc(syms, publish));
        else if (ex === "gate") stops.push(runGate(syms, publish));
        else if (ex === "bybit") stops.push(runBybit(syms, publish));
        else if (ex === "kucoin") stops.push(runKucoin(syms, publish));
        else if (ex === "okx") stops.push(runOkx(syms, publish));
      }
      if (ex === "mexc" && symbols.length === 0) {
        stops.push(runMexc(["BTCUSDT", "ETHUSDT"], publish));
      }
    } catch (e) {
      console.warn(`[cex-engine] ${ex} init:`, (e as Error).message);
    }
  }

  const healthServer = await import("node:http").then(({ createServer }) =>
    createServer((req, res) => {
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({ ok: true, service: "cex-market-engine", exchanges: EXCHANGES })
        );
        return;
      }
      res.writeHead(404).end();
    })
  );
  healthServer.listen(HEALTH_PORT, () => console.log(`[cex-market-engine] Health on :${HEALTH_PORT}`));

  process.on("SIGTERM", () => {
    stops.forEach((s) => s());
    nc.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
