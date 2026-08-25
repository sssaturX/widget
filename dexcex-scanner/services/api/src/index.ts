/**
 * DEX-CEX API — REST API for signals, health, metrics
 */
import express from "express";
import cors from "cors";
import { connect, type NatsConnection } from "nats";

const PORT = Number(process.env.PORT) || 3002;
const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const CORS_ORIGINS = process.env.CORS_ORIGINS; // e.g. "https://app.example.com,https://dashboard.example.com"

const app = express();
app.use(
  cors({
    origin: CORS_ORIGINS
      ? CORS_ORIGINS.split(",").map((o) => o.trim())
      : true, // allow all when unset (dev)
  })
);
app.use(express.json());

let nc: NatsConnection;
const signals: unknown[] = [];
const MAX_SIGNALS = 500;
let signalsTotal = 0;

async function main() {
  nc = await connect({ servers: NATS_URL });
  const sub = nc.subscribe("signals.generated");
  (async () => {
    for await (const msg of sub) {
      try {
        const d = JSON.parse(msg.data.toString());
        signals.unshift(d);
        signalsTotal++;
        if (signals.length > MAX_SIGNALS) signals.pop();
      } catch {
        /* ignore */
      }
    }
  })().catch(() => {});

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "dexcex-api", nats: !nc.isClosed() });
  });

  app.get("/api/signals", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json({ signals: signals.slice(0, limit) });
  });

  app.get("/api/dexcex/signals", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json({ signals: signals.slice(0, limit) });
  });

  app.get("/api/dexcex/status", (_req, res) => {
    res.json({
      ok: true,
      service: "dexcex-scanner",
      signals_count: signals.length,
      signals_total: signalsTotal,
      status: "running",
    });
  });

  app.get("/metrics", (_req, res) => {
    res.set("Content-Type", "text/plain");
    res.send(
      `# HELP dexcex_signals_total Total signals generated\n` +
        `# TYPE dexcex_signals_total counter\n` +
        `dexcex_signals_total ${signalsTotal}\n` +
        `# HELP dexcex_signals_buffer Current signals in buffer\n` +
        `# TYPE dexcex_signals_buffer gauge\n` +
        `dexcex_signals_buffer ${signals.length}\n`
    );
  });

  app.listen(PORT, () => console.log(`[dexcex-api] Listening on :${PORT}`));

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
