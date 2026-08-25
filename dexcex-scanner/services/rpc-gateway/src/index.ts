/**
 * RPC Gateway — blockchain RPC with load balancing, retries, circuit breaker
 */
import { createServer } from "node:http";

const CHAINS: Record<string, string[]> = {
  ethereum: [
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://ethereum.publicnode.com",
    "https://1rpc.io/eth",
  ],
  bsc: [
    "https://bsc-dataseed.binance.org",
    "https://rpc.ankr.com/bsc",
    "https://bsc-dataseed1.defibit.io",
    "https://bsc.publicnode.com",
  ],
  arbitrum: [
    "https://arb1.arbitrum.io/rpc",
    "https://rpc.ankr.com/arbitrum_one",
    "https://arbitrum.publicnode.com",
  ],
  base: [
    "https://mainnet.base.org",
    "https://rpc.ankr.com/base",
    "https://base.publicnode.com",
  ],
  polygon: [
    "https://polygon-rpc.com",
    "https://rpc.ankr.com/polygon",
    "https://polygon-bor.publicnode.com",
  ],
  optimism: [
    "https://mainnet.optimism.io",
    "https://rpc.ankr.com/optimism",
    "https://optimism.publicnode.com",
  ],
  avalanche: [
    "https://api.avax.network/ext/bc/C/rpc",
    "https://rpc.ankr.com/avalanche",
  ],
  fantom: ["https://rpc.ftm.tools", "https://rpc.ankr.com/fantom"],
};

const PORT = Number(process.env.PORT) || 8545;
const HEALTH_PORT = Number(process.env.HEALTH_PORT) || 8546;

let currentIndex: Record<string, number> = {};
const FAILURE_THRESHOLD = 5;
const failureCount: Record<string, number> = {};
const circuitOpen: Record<string, number> = {};
const OPEN_MS = 60_000;

/** Per-chain RPC URLs: env RPC_ETHEREUM, RPC_BSC, etc. override built-in list (comma-separated = fallbacks). */
function getUrlsForChain(chain: string): string[] {
  const key = `RPC_${chain.toUpperCase().replace(/-/g, "_")}`;
  const env = process.env[key];
  if (env) {
    return env.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return CHAINS[chain] ?? [];
}

function getNextUrl(chain: string): string | null {
  const urls = getUrlsForChain(chain);
  if (!urls.length) return null;
  const idx = (currentIndex[chain] ?? 0) % urls.length;
  return urls[idx]!;
}

function rotateChain(chain: string): void {
  currentIndex[chain] = (currentIndex[chain] ?? 0) + 1;
}

async function proxyRpc(chain: string, body: string): Promise<{ status: number; data: string }> {
  const url = getNextUrl(chain);
  if (!url) return { status: 502, data: JSON.stringify({ error: { message: "Unknown chain" } }) };

  if ((circuitOpen[chain] ?? 0) > Date.now()) {
    rotateChain(chain);
    return { status: 503, data: JSON.stringify({ error: { message: "Circuit open" } }) };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.text();
    const isHtml = data.trimStart().startsWith("<");
    const isJson = !isHtml && (() => { try { JSON.parse(data); return true; } catch { return false; } })();
    if (!res.ok || isHtml || !isJson) {
      failureCount[chain] = (failureCount[chain] ?? 0) + 1;
      if (failureCount[chain]! >= FAILURE_THRESHOLD) {
        circuitOpen[chain] = Date.now() + OPEN_MS;
        failureCount[chain] = 0;
        rotateChain(chain);
      }
      const msg = !res.ok ? `Upstream ${res.status}` : isHtml ? "Upstream returned HTML (rate limit/block)" : "Upstream returned invalid JSON";
      return { status: 502, data: JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: msg } }) };
    }
    failureCount[chain] = 0;
    return { status: 200, data };
  } catch (e) {
    failureCount[chain] = (failureCount[chain] ?? 0) + 1;
    if (failureCount[chain]! >= FAILURE_THRESHOLD) {
      circuitOpen[chain] = Date.now() + OPEN_MS;
      failureCount[chain] = 0;
      rotateChain(chain);
    }
    return { status: 502, data: JSON.stringify({ error: { message: (e as Error).message } }) };
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  let chain = "ethereum";
  try {
    const parsed = JSON.parse(body);
    const id = parsed.id ?? parsed.params?.[0];
    if (typeof id === "string" && id.startsWith("chain:")) {
      chain = id.slice(6).toLowerCase();
    }
  } catch {
    /* use default */
  }
  const { status, data } = await proxyRpc(chain, body);
  res.writeHead(status, { "Content-Type": "application/json" }).end(data);
});

const healthServer = createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, service: "rpc-gateway" }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, () => console.log(`[rpc-gateway] RPC on :${PORT}`));
healthServer.listen(HEALTH_PORT, () => console.log(`[rpc-gateway] Health on :${HEALTH_PORT}`));

process.on("SIGTERM", () => {
  server.close();
  healthServer.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  server.close();
  healthServer.close();
  process.exit(0);
});
