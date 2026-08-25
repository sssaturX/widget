/**
 * DEX Price Aggregator — fetches DEX prices from aggregator APIs (no RPC).
 * Publishes: dex.liquidity (same format as dex-indexer so spread-engine works unchanged).
 *
 * Modes:
 * - AGGREGATOR_URL: GET URL, expect JSON array of { chain, token, price, tvl_usd?, protocol?, pool? }
 * - AGGREGATOR_TYPE=defillama: fetch from coins.llama.fi with built-in token list
 */
import { connect } from "nats";
import { getDefiLlamaCoinIds } from "./config.js";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const AGGREGATOR_URL = process.env.AGGREGATOR_URL ?? "";
const AGGREGATOR_TYPE = (process.env.AGGREGATOR_TYPE ?? "generic").toLowerCase();
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 15_000;
const HEALTH_PORT = Number(process.env.HEALTH_PORT) || 8092;

const encoder = new TextEncoder();
const DEFILLAMA_URL = "https://coins.llama.fi/prices/current";

interface AggregatorRow {
  chain: string;
  token: string;
  price: number;
  tvl_usd?: number;
  protocol?: string;
  pool?: string;
}

/** EVM addresses are lowercased; Solana/base58 kept as-is (case-sensitive). */
function normalizeToken(chain: string, token: string): string {
  const t = String(token).trim();
  return t.startsWith("0x") ? t.toLowerCase() : t;
}

function normalizeRow(raw: Record<string, unknown>): AggregatorRow | null {
  const chain = String(raw.chain ?? "").toLowerCase();
  const tokenRaw = String(raw.token ?? raw.address ?? "").trim();
  const token = normalizeToken(chain, tokenRaw);
  const price = Number(raw.price ?? 0);
  if (!chain || !token || !Number.isFinite(price) || price <= 0) return null;
  return {
    chain,
    token,
    price,
    tvl_usd: Number(raw.tvl_usd ?? raw.tvl ?? raw.liquidity_usd ?? 0) || undefined,
    protocol: raw.protocol != null ? String(raw.protocol) : undefined,
    pool: raw.pool != null ? String(raw.pool) : undefined,
  };
}

/** Fetch from generic REST: GET AGGREGATOR_URL, expect array or { data: array } */
async function fetchGeneric(): Promise<AggregatorRow[]> {
  if (!AGGREGATOR_URL) return [];
  const res = await fetch(AGGREGATOR_URL, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Aggregator ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) throw new Error("Aggregator returned HTML");
  const json = JSON.parse(text) as unknown;
  const arr = Array.isArray(json) ? json : (json as Record<string, unknown>).data ?? (json as Record<string, unknown>).prices ?? [];
  if (!Array.isArray(arr)) return [];
  const out: AggregatorRow[] = [];
  for (const item of arr) {
    const row = normalizeRow(item as Record<string, unknown>);
    if (row) out.push(row);
  }
  return out;
}

const DEFILLAMA_BATCH = 40; // URL length limit: batch coin ids

/** Fetch from DeFiLlama coins.llama.fi — GET with comma-separated coin ids in path, returns { coins: { "chain:addr": { price } } } */
async function fetchDefiLlama(): Promise<AggregatorRow[]> {
  const coinIds = getDefiLlamaCoinIds();
  if (coinIds.length === 0) return [];
  const out: AggregatorRow[] = [];
  for (let i = 0; i < coinIds.length; i += DEFILLAMA_BATCH) {
    const batch = coinIds.slice(i, i + DEFILLAMA_BATCH);
    const path = batch.join(",");
    const res = await fetch(`${DEFILLAMA_URL}/${path}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`DeFiLlama ${res.status}`);
    const data = (await res.json()) as { coins?: Record<string, { price?: number }> };
    const coins = data.coins ?? {};
    for (const [id, info] of Object.entries(coins)) {
      const price = info?.price;
      if (price == null || !Number.isFinite(price) || price <= 0) continue;
      const [chainPart, tokenPart] = id.split(":");
      if (!chainPart || !tokenPart) continue;
      out.push({
        chain: chainPart.toLowerCase(),
        token: tokenPart.startsWith("0x") ? tokenPart.toLowerCase() : tokenPart,
        price,
        protocol: "defillama",
      });
    }
  }
  return out;
}

async function poll(nc: import("nats").NatsConnection): Promise<void> {
  let rows: AggregatorRow[];
  try {
    if (AGGREGATOR_TYPE === "defillama") {
      rows = await fetchDefiLlama();
    } else {
      rows = await fetchGeneric();
    }
  } catch (e) {
    console.warn("[dex-price-aggregator] fetch error:", (e as Error).message);
    return;
  }
  const ts = Date.now();
  for (const r of rows) {
    const payload = {
      chain: r.chain,
      token: r.token,
      price: r.price,
      tvl_usd: r.tvl_usd,
      protocol: r.protocol ?? "aggregator",
      pool: r.pool,
      ts,
    };
    nc.publish("dex.liquidity", encoder.encode(JSON.stringify(payload)));
  }
  if (rows.length > 0) {
    console.log(`[dex-price-aggregator] published ${rows.length} DEX prices`);
  }
}

async function main(): Promise<void> {
  const nc = await connect({ servers: NATS_URL });

  if (AGGREGATOR_TYPE === "defillama" || AGGREGATOR_URL) {
    await poll(nc);
    setInterval(() => poll(nc), POLL_INTERVAL_MS);
  } else {
    console.warn("[dex-price-aggregator] Set AGGREGATOR_URL or AGGREGATOR_TYPE=defillama");
  }

  const http = await import("node:http");
  const server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({ ok: true, service: "dex-price-aggregator", type: AGGREGATOR_TYPE || "none" })
      );
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(HEALTH_PORT, () => console.log(`[dex-price-aggregator] Health on :${HEALTH_PORT}`));

  process.on("SIGTERM", () => {
    nc.close();
    server.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
