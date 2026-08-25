/**
 * DEX Indexer — indexes PairCreated, Swap, Sync, Mint, Burn from Uniswap V2–style DEX
 * Publishes: dex.events, dex.liquidity, tokens.new
 */
import { connect, type NatsConnection } from "nats";
import {
  CHAINS,
  DEX_PROTOCOLS,
  PAIR_CREATED_TOPIC,
  SWAP_TOPIC,
  SYNC_TOPIC,
  MINT_TOPIC,
  BURN_TOPIC,
  USDT_ADDRESSES,
} from "./config.js";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const RPC_URL = process.env.RPC_URL ?? "http://localhost:8545";
const HEALTH_PORT = Number(process.env.HEALTH_PORT) || 8088;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 4000;
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 2000;

const encoder = new TextEncoder();
const lastBlock: Record<string, number> = {};
const poolTokens = new Map<string, { token0: string; token1: string }>();
const POOL_TOKENS_MAX = 50_000;

function evictPoolTokensIfNeeded(): void {
  if (poolTokens.size <= POOL_TOKENS_MAX) return;
  const toDelete = [...poolTokens.keys()].slice(0, 10_000);
  for (const k of toDelete) poolTokens.delete(k);
}

async function fetchRpc(url: string, method: string, params: unknown[], chain?: string): Promise<unknown> {
  const id = chain && url === RPC_URL ? `chain:${chain}` : 1;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error(`RPC returned HTML instead of JSON (rate limit or error page): ${text.slice(0, 80)}...`);
  }
  let d: { result?: unknown; error?: { message?: string } };
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error(`RPC returned invalid JSON: ${text.slice(0, 120)}...`);
  }
  if (d.error) throw new Error(d.error.message ?? "RPC error");
  return d.result;
}

function parseHex(num: string): number {
  return parseInt(String(num), 16) || 0;
}

function parseAddr(num: string): string {
  const h = String(num).toLowerCase();
  return h.startsWith("0x") ? h : "0x" + h.padStart(40, "0");
}

async function indexChain(
  nc: NatsConnection,
  chain: string,
  rpcUrl: string,
  protocol: string,
  factory: string
): Promise<void> {
  const key = `${chain}:${protocol}`;
  let from = lastBlock[key] ?? 0;
  if (from === 0) {
    const bn = await fetchRpc(rpcUrl, "eth_blockNumber", [], chain);
    from = Math.max(0, parseHex(String(bn)) - 100);
    lastBlock[key] = from;
  }

  const toHex = (n: number) => "0x" + n.toString(16);
  const toBlock = from + BATCH_SIZE;

  const pairAddrs = new Set<string>();
  for (const [k, v] of poolTokens) {
    if (k.startsWith(`${chain}:${protocol}:`)) {
      const p = k.split(":")[2];
      if (p) pairAddrs.add(p);
    }
  }
  const addresses = [factory, ...pairAddrs];

  try {
    const logs = (await fetchRpc(rpcUrl, "eth_getLogs", [
      {
        fromBlock: toHex(from),
        toBlock: toHex(toBlock),
        address: addresses.length > 1 ? addresses : factory,
        topics: [[PAIR_CREATED_TOPIC, SWAP_TOPIC, SYNC_TOPIC, MINT_TOPIC, BURN_TOPIC]],
      },
    ], chain)) as Array<{ address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string }>;

    for (const log of logs ?? []) {
      const topic0 = (log.topics?.[0] ?? "").toLowerCase();
      const emitter = parseAddr(log.address);
      const pair = topic0 === PAIR_CREATED_TOPIC ? parseAddr("0x" + (log.data ?? "0x").slice(-40)) : emitter;
      if (!pair || pair === "0x0") continue;
      const block = parseHex(log.blockNumber ?? "0");
      const tx = log.transactionHash ?? "";

      if (topic0 === PAIR_CREATED_TOPIC) {
        const token0 = parseAddr("0x" + (log.topics?.[1] ?? "").slice(26));
        const token1 = parseAddr("0x" + (log.topics?.[2] ?? "").slice(26));
        const pairAddr = parseAddr("0x" + (log.data ?? "0x").slice(-40));
        poolTokens.set(`${chain}:${protocol}:${pairAddr}`, { token0, token1 });
        evictPoolTokensIfNeeded();
        const payload = JSON.stringify({
          chain,
          protocol,
          event: "PairCreated",
          pool: pairAddr,
          token0,
          token1,
          tx,
          block,
          ts: Date.now(),
        });
        nc.publish("dex.events", encoder.encode(payload));
        for (const t of [token0, token1]) {
          if (t && t !== "0x0") {
            nc.publish("tokens.new", encoder.encode(JSON.stringify({ chain, address: t, ts: Date.now() })));
          }
        }
      } else if (topic0 === SWAP_TOPIC) {
        const data = log.data ?? "0x";
        const amount0In = BigInt("0x" + data.slice(2, 66));
        const amount1In = BigInt("0x" + data.slice(66, 130));
        const amount0Out = BigInt("0x" + data.slice(130, 194));
        const amount1Out = BigInt("0x" + data.slice(194, 258));
        const payload = JSON.stringify({
          chain,
          protocol,
          event: "Swap",
          pool: pair,
          amount0In: amount0In.toString(),
          amount1In: amount1In.toString(),
          amount0Out: amount0Out.toString(),
          amount1Out: amount1Out.toString(),
          tx,
          block,
          ts: Date.now(),
        });
        nc.publish("dex.events", encoder.encode(payload));
      } else if (topic0 === SYNC_TOPIC) {
        const data = log.data ?? "0x";
        const reserve0 = BigInt("0x" + data.slice(2, 66));
        const reserve1 = BigInt("0x" + data.slice(66, 130));
        const evtPayload = JSON.stringify({
          chain,
          protocol,
          event: "Sync",
          pool: pair,
          reserve0: reserve0.toString(),
          reserve1: reserve1.toString(),
          tx,
          block,
          ts: Date.now(),
        });
        nc.publish("dex.events", encoder.encode(evtPayload));

        const pt = poolTokens.get(`${chain}:${protocol}:${pair}`);
        if (pt) {
          const r0 = Number(reserve0);
          const r1 = Number(reserve1);
          const isUsdt0 = USDT_ADDRESSES.has(pt.token0.toLowerCase());
          const isUsdt1 = USDT_ADDRESSES.has(pt.token1.toLowerCase());
          let price = 0;
          let token = pair;
          if (isUsdt0 && r1 > 0) {
            price = r0 / r1;
            token = pt.token1;
          } else if (isUsdt1 && r0 > 0) {
            price = r1 / r0;
            token = pt.token0;
          }
          if (price > 0) {
            const tvlUsd = isUsdt0 ? 2 * (r0 / 1e6) : isUsdt1 ? 2 * (r1 / 1e6) : 0;
            const liqPayload = JSON.stringify({
              chain,
              protocol,
              pool: pair,
              token,
              price,
              reserve0: reserve0.toString(),
              reserve1: reserve1.toString(),
              tvl_usd: tvlUsd,
              ts: Date.now(),
            });
            nc.publish("dex.liquidity", encoder.encode(liqPayload));
          }
        }
      } else if (topic0 === MINT_TOPIC || topic0 === BURN_TOPIC) {
        const data = log.data ?? "0x";
        const a0 = data.length >= 66 ? "0x" + data.slice(2, 66) : "0";
        const a1 = data.length >= 130 ? "0x" + data.slice(66, 130) : "0";
        nc.publish("dex.events", encoder.encode(JSON.stringify({
          chain,
          protocol,
          event: topic0 === MINT_TOPIC ? "Mint" : "Burn",
          pool: pair,
          amount0: a0,
          amount1: a1,
          tx,
          block,
          ts: Date.now(),
        })));
      }
    }

    lastBlock[key] = toBlock + 1;
  } catch (e) {
    console.warn(`[dex-indexer] ${chain}/${protocol} poll error:`, (e as Error).message);
  }
}

async function main() {
  const nc = await connect({ servers: NATS_URL });

  const chains = Object.entries(CHAINS);
  const interval = setInterval(async () => {
    try {
      for (const dex of DEX_PROTOCOLS) {
        const chainConfig = chains.find(([k]) => k === dex.chain)?.[1];
        if (!chainConfig) continue;
        const useGateway = RPC_URL && !RPC_URL.includes("localhost");
        const rpc = useGateway ? RPC_URL : (process.env[`RPC_${dex.chain.toUpperCase()}`] ?? chainConfig.rpc ?? RPC_URL);
        await indexChain(nc, dex.chain, rpc, dex.protocol, dex.factory);
      }
    } catch (e) {
      console.warn("[dex-indexer] poll round error:", (e as Error).message);
    }
  }, POLL_INTERVAL_MS);

  const healthServer = await import("node:http").then(({ createServer }) =>
    createServer((_req, res) => {
      if (_req.url === "/health" && _req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({ ok: true, service: "dex-indexer", lastBlock })
        );
        return;
      }
      res.writeHead(404).end();
    })
  );
  healthServer.listen(HEALTH_PORT, () => console.log(`[dex-indexer] Health on :${HEALTH_PORT}`));

  process.on("SIGTERM", () => {
    clearInterval(interval);
    nc.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
