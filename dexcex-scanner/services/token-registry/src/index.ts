/**
 * Token Registry — maps DEX token contracts to CEX symbols
 * Consumes: tokens.new, dex.events (PairCreated)
 * Exposes: REST API /api/registry/bulk, /api/registry/:chain/:address
 */
import { connect } from "nats";
import { createServer } from "node:http";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const HEALTH_PORT = Number(process.env.HEALTH_PORT) || 8089;

const KNOWN_MAP: Record<string, string> = {
  "ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7": "USDTUSDT",
  "ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDCUSDT",
  "ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETHUSDT",
  "bsc:0x55d398326f99059ff775485246999027b3197955": "USDTUSDT",
  "bsc:0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": "USDCUSDT",
  "bsc:0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c": "WBNBUSDT",
  "arbitrum:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": "USDTUSDT",
  "arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831": "USDCUSDT",
  "polygon:0xc2132d05d31c914a87c6611c10748aeb04b58e8f": "USDTUSDT",
  "polygon:0x2791bca1f2de4661ed88a30c99a7a9449aa84174": "USDCUSDT",
  "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDCUSDT",
};

const registry = new Map<string, Set<string>>();

function key(chain: string, addr: string): string {
  return `${chain}:${(addr ?? "").toLowerCase()}`;
}

async function main() {
  const nc = await connect({ servers: NATS_URL });

  for (const [k, sym] of Object.entries(KNOWN_MAP)) {
    if (!registry.has(k)) registry.set(k, new Set());
    registry.get(k)!.add(sym);
  }

  const subTokens = nc.subscribe("tokens.new");
  (async () => {
    for await (const msg of subTokens) {
      try {
        const d = JSON.parse(msg.data.toString());
        const chain = d.chain ?? "ethereum";
        const addr = (d.address ?? "").toLowerCase();
        if (!addr || addr === "0x0") continue;
        const k = key(chain, addr);
        if (!registry.has(k)) registry.set(k, new Set());
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
          const addr = (t ?? "").toLowerCase();
          if (!addr || addr === "0x0") continue;
          const k = key(chain, addr);
          if (!registry.has(k)) registry.set(k, new Set());
        }
      } catch {
        /* ignore */
      }
    }
  })().catch(() => {});

  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200).end(JSON.stringify({ ok: true, service: "token-registry", count: registry.size }));
      return;
    }
    if (req.url === "/api/registry/bulk" && req.method === "GET") {
      const mappings: Record<string, string> = {};
      for (const [k, syms] of registry) {
        const first = [...syms][0];
        if (first) mappings[k] = first;
      }
      for (const [k, sym] of Object.entries(KNOWN_MAP)) {
        mappings[k] = sym;
      }
      res.writeHead(200).end(JSON.stringify({ mappings }));
      return;
    }
    const m = req.url?.match(/^\/api\/registry\/([^/]+)\/([^/]+)$/);
    if (m && req.method === "GET") {
      const [, chain, address] = m;
      const k = key(chain, address);
      const sym = KNOWN_MAP[k] ?? [...(registry.get(k) ?? [])][0] ?? null;
      res.writeHead(200).end(JSON.stringify({ chain, address, symbol: sym }));
      return;
    }
    res.writeHead(404).end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(HEALTH_PORT, () => console.log(`[token-registry] Health on :${HEALTH_PORT}`));

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
