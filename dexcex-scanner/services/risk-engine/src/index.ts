/**
 * Risk Engine — filters malicious tokens
 * Consumes: tokens.new, dex.events (PairCreated)
 * Publishes: risk.results
 * Checks: no-contract, eth_getCode, basic contract validation
 */
import { connect } from "nats";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const RPC_URL = process.env.RPC_URL ?? "http://localhost:8545";
const HEALTH_PORT = Number(process.env.HEALTH_PORT) || 8090;
const RISK_THRESHOLD = Number(process.env.RISK_THRESHOLD) || 50;

const encoder = new TextEncoder();
const cache = new Map<string, { passed: boolean; score: number; ts: number }>();
const CACHE_TTL_MS = 300_000;

async function fetchRpc(chain: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: `chain:${chain}`, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return d.result;
}

async function checkToken(chain: string, address: string): Promise<{ passed: boolean; score: number; flags: string[] }> {
  const key = `${chain}:${address.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { passed: cached.passed, score: cached.score, flags: [] };
  }

  const flags: string[] = [];
  let score = 0;

  try {
    const code = await fetchRpc(chain, "eth_getCode", [address, "latest"]);
    if (!code || String(code) === "0x" || String(code).length < 10) {
      flags.push("no_contract");
      score = 100;
      const result = { passed: false, score, flags };
      cache.set(key, { passed: false, score, ts: Date.now() });
      return result;
    }
  } catch {
    flags.push("rpc_error");
    score = 50;
  }

  const passed = score < RISK_THRESHOLD;
  cache.set(key, { passed, score, ts: Date.now() });
  return { passed, score, flags };
}

async function main() {
  const nc = await connect({ servers: NATS_URL });

  const processAddr = async (chain: string, address: string) => {
    if (!address || address === "0x0") return;
    try {
      const { passed, score, flags } = await checkToken(chain, address);
      const payload = JSON.stringify({
        chain,
        address: address.toLowerCase(),
        passed,
        risk_score: score,
        flags,
        ts: Date.now(),
      });
      nc.publish("risk.results", encoder.encode(payload));
    } catch {
      /* ignore */
    }
  };

  const subTokens = nc.subscribe("tokens.new");
  (async () => {
    for await (const msg of subTokens) {
      try {
        const d = JSON.parse(msg.data.toString());
        await processAddr(d.chain ?? "ethereum", d.address ?? "");
      } catch {
        /* ignore */
      }
    }
  })().catch(() => {});

  const subDex = nc.subscribe("dex.events");
  (async () => {
    for await (const msg of subDex) {
      try {
        const d = JSON.parse(msg.data.toString());
        if (d.event !== "PairCreated") continue;
        const chain = d.chain ?? "ethereum";
        for (const t of [d.token0, d.token1]) {
          if (t) await processAddr(chain, t);
        }
      } catch {
        /* ignore */
      }
    }
  })().catch(() => {});

  const healthServer = await import("node:http").then(({ createServer }) =>
    createServer((req, res) => {
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({ ok: true, service: "risk-engine", cacheSize: cache.size })
        );
        return;
      }
      res.writeHead(404).end();
    })
  );
  healthServer.listen(HEALTH_PORT, () => console.log(`[risk-engine] Health on :${HEALTH_PORT}`));

  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL_MS) cache.delete(k);
    }
  }, 60_000);

  process.on("SIGTERM", () => {
    subTokens.unsubscribe();
    subDex.unsubscribe();
    nc.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
