/**
 * CEX WebSocket connectors — Binance, MEXC, Gate, Bybit, Kucoin, OKX
 * Circuit breaker: 5 consecutive failures → pause 60s
 */
import { WebSocket } from "undici";

const encoder = new TextEncoder();
type PublishFn = (topic: string, data: Uint8Array) => void;

const BINANCE_WS = "wss://fstream.binance.com/ws/!ticker@arr";
const MEXC_WS = "wss://contract.mexc.com/edge";
const GATE_WS = "wss://fx-ws.gateio.ws/v4/ws/usdt";
const BYBIT_WS = "wss://stream.bybit.com/v5/public/linear";
const KUCOIN_WS = "wss://ws-futures.kucoin.com";
const OKX_WS = "wss://ws.okx.com:8443/ws/v5/public";

const CIRCUIT_FAILURES = 5;
const CIRCUIT_PAUSE_MS = 60_000;
const failureCount: Record<string, number> = {};
const circuitOpenUntil: Record<string, number> = {};

function toMexcSymbol(s: string): string {
  const m = s.match(/^(.+)(USDT)$/i);
  return m ? m[1] + "_" + m[2] : s;
}

function toGateSymbol(s: string): string {
  if (/USDT$/i.test(s)) return s.slice(0, -4) + "_USDT";
  return s.replace(/([A-Z0-9]+)(USDT)/i, "$1_$2");
}

function shouldPublish(ex: string): boolean {
  if ((circuitOpenUntil[ex] ?? 0) > Date.now()) return false;
  return true;
}

function recordSuccess(ex: string): void {
  failureCount[ex] = 0;
}

function recordFailure(ex: string): void {
  failureCount[ex] = (failureCount[ex] ?? 0) + 1;
  if (failureCount[ex]! >= CIRCUIT_FAILURES) {
    circuitOpenUntil[ex] = Date.now() + CIRCUIT_PAUSE_MS;
    failureCount[ex] = 0;
  }
}

export function runBinance(publish: PublishFn): () => void {
  const ex = "binance";
  const ws = new WebSocket(BINANCE_WS);
  ws.addEventListener("message", (e: { data: string | Buffer }) => {
    if (!shouldPublish(ex)) return;
    const raw = typeof e.data === "string" ? e.data : e.data.toString();
    try {
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : [data];
      for (const row of items) {
        const s = row.s;
        const c = parseFloat(row.c ?? "0");
        const ts = row.E ?? Date.now();
        if (!s || !Number.isFinite(c) || c <= 0) continue;
        publish("cex.prices", encoder.encode(JSON.stringify({ exchange: "binance", symbol: String(s).toUpperCase(), bid: c, ask: c, last: c, ts })));
        recordSuccess(ex);
      }
    } catch {
      recordFailure(ex);
    }
  });
  ws.addEventListener("close", () => setTimeout(() => runBinance(publish), 5000));
  return () => ws.close();
}

export function runMexc(symbols: string[], publish: PublishFn): () => void {
  const ex = "mexc";
  const ws = new WebSocket(MEXC_WS);
  let pingId: ReturnType<typeof setInterval> | null = null;
  const useAll = symbols.length >= 80;
  ws.addEventListener("open", () => {
    if (useAll) ws.send(JSON.stringify({ method: "sub.tickers", param: {} }));
    else for (const s of symbols) ws.send(JSON.stringify({ method: "sub.ticker", param: { symbol: toMexcSymbol(s) } }));
    pingId = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ method: "ping" })); }, 15000);
  });
  ws.addEventListener("message", (e: { data: string | Buffer }) => {
    if (!shouldPublish(ex)) return;
    const raw = typeof e.data === "string" ? e.data : e.data.toString();
    try {
      const msg = JSON.parse(raw);
      if (msg.channel === "pong") return;
      const items = Array.isArray(msg.data) ? msg.data : msg.data ? [msg.data] : [];
      for (const d of items) {
        const symbol = d.symbol?.replace(/_/g, "");
        const last = Number(d.lastPrice) || Number(d.fairPrice) || (Number(d.bid1) + Number(d.ask1)) / 2;
        const ts = d.timestamp ?? Date.now();
        if (!symbol || !Number.isFinite(last) || last <= 0) continue;
        publish("cex.prices", encoder.encode(JSON.stringify({ exchange: "mexc", symbol: symbol.toUpperCase(), bid: last, ask: last, last, ts })));
        recordSuccess(ex);
      }
    } catch {
      recordFailure(ex);
    }
  });
  ws.addEventListener("close", () => setTimeout(() => runMexc(symbols, publish), 5000));
  return () => { pingId && clearInterval(pingId); ws.close(); };
}

export function runGate(symbols: string[], publish: PublishFn): () => void {
  const ex = "gate";
  const ws = new WebSocket(GATE_WS);
  let pingId: ReturnType<typeof setInterval> | null = null;
  const send = (o: object) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  ws.addEventListener("open", () => {
    for (let i = 0; i < symbols.length; i += 100) {
      const batch = symbols.slice(i, i + 100).map(toGateSymbol);
      send({ time: Math.floor(Date.now() / 1000), channel: "futures.tickers", event: "subscribe", payload: batch });
    }
    pingId = setInterval(() => send({ time: Math.floor(Date.now() / 1000), channel: "futures.ping" }), 15000);
  });
  ws.addEventListener("message", (e: { data: string | Buffer }) => {
    if (!shouldPublish(ex)) return;
    const raw = typeof e.data === "string" ? e.data : e.data.toString();
    try {
      const msg = JSON.parse(raw);
      if (msg.channel === "futures.pong" || msg.channel !== "futures.tickers" || msg.event !== "update" || !msg.result) return;
      const r = msg.result;
      const symbol = (r.contract ?? r.s)?.replace(/_/g, "");
      const last = parseFloat(r.last ?? r.last_price ?? r.mark_price ?? "0");
      const ts = r.t ?? Date.now();
      if (!symbol || !Number.isFinite(last) || last <= 0) return;
      publish("cex.prices", encoder.encode(JSON.stringify({ exchange: "gate", symbol: symbol.toUpperCase(), bid: last, ask: last, last, ts })));
      recordSuccess(ex);
    } catch {
      recordFailure(ex);
    }
  });
  ws.addEventListener("close", () => setTimeout(() => runGate(symbols, publish), 5000));
  return () => { pingId && clearInterval(pingId); ws.close(); };
}

export function runBybit(symbols: string[], publish: PublishFn): () => void {
  const ex = "bybit";
  const ws = new WebSocket(BYBIT_WS);
  let pingId: ReturnType<typeof setInterval> | null = null;
  ws.addEventListener("open", () => {
    for (let i = 0; i < symbols.length; i += 300) {
      const batch = symbols.slice(i, i + 300).map((s) => "tickers." + s);
      ws.send(JSON.stringify({ op: "subscribe", args: batch }));
    }
    pingId = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ op: "ping" })); }, 15000);
  });
  ws.addEventListener("message", (e: { data: string | Buffer }) => {
    if (!shouldPublish(ex)) return;
    const raw = typeof e.data === "string" ? e.data : e.data.toString();
    try {
      const msg = JSON.parse(raw);
      if (msg.topic?.startsWith("pong") || !msg.data) return;
      const d = msg.data;
      const symbol = d.symbol;
      const last = parseFloat(d.lastPrice ?? "0");
      const ts = d.ts ?? Date.now();
      if (!symbol || !Number.isFinite(last) || last <= 0) return;
      publish("cex.prices", encoder.encode(JSON.stringify({ exchange: "bybit", symbol: symbol.toUpperCase(), bid: last, ask: last, last, ts })));
      recordSuccess(ex);
    } catch {
      recordFailure(ex);
    }
  });
  ws.addEventListener("close", () => setTimeout(() => runBybit(symbols, publish), 5000));
  return () => { pingId && clearInterval(pingId); ws.close(); };
}

export function runKucoin(symbols: string[], publish: PublishFn): () => void {
  const ex = "kucoin";
  const ws = new WebSocket(KUCOIN_WS);
  let pingId: ReturnType<typeof setInterval> | null = null;
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "subscribe", topic: "/contractMarket/tickerV2", privateChannel: false }));
    pingId = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" })); }, 15000);
  });
  ws.addEventListener("message", (e: { data: string | Buffer }) => {
    if (!shouldPublish(ex)) return;
    try {
      const raw = typeof e.data === "string" ? e.data : e.data.toString();
      const msg = JSON.parse(raw);
      if (msg.type === "pong") return;
      const d = msg.data;
      if (!d) return;
      const symbol = (d.symbol ?? "").replace(/-/g, "").toUpperCase();
      const last = parseFloat(d.lastTradePrice ?? d.price ?? "0");
      const ts = Number(d.time ?? Date.now());
      if (!symbol || !Number.isFinite(last) || last <= 0) return;
      publish("cex.prices", encoder.encode(JSON.stringify({ exchange: "kucoin", symbol, bid: last, ask: last, last, ts })));
      recordSuccess(ex);
    } catch {
      recordFailure(ex);
    }
  });
  ws.addEventListener("close", () => setTimeout(() => runKucoin(symbols, publish), 5000));
  return () => { pingId && clearInterval(pingId); ws.close(); };
}

export function runOkx(symbols: string[], publish: PublishFn): () => void {
  const ex = "okx";
  const ws = new WebSocket(OKX_WS);
  let pingId: ReturnType<typeof setInterval> | null = null;
  const instIds = symbols.slice(0, 300).map((s) => (s.replace("USDT", "") + "-USDT-SWAP"));
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ op: "subscribe", args: instIds.map((id) => ({ channel: "tickers", instId: id })) }));
    pingId = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ op: "ping" })); }, 25000);
  });
  ws.addEventListener("message", (e: { data: string | Buffer }) => {
    if (!shouldPublish(ex)) return;
    try {
      const raw = typeof e.data === "string" ? e.data : e.data.toString();
      const msg = JSON.parse(raw);
      if (msg.event === "pong" || !msg.data) return;
      const list = Array.isArray(msg.data) ? msg.data : [msg.data];
      for (const d of list) {
        const instId = d.instId ?? "";
        const symbol = instId.replace(/-/g, "").toUpperCase();
        const last = parseFloat(d.last ?? d.bidPx ?? d.askPx ?? "0");
        const ts = Number(d.ts ?? Date.now());
        if (!symbol || !Number.isFinite(last) || last <= 0) continue;
        publish("cex.prices", encoder.encode(JSON.stringify({ exchange: "okx", symbol, bid: last, ask: last, last, ts })));
        recordSuccess(ex);
      }
    } catch {
      recordFailure(ex);
    }
  });
  ws.addEventListener("close", () => setTimeout(() => runOkx(symbols, publish), 5000));
  return () => { pingId && clearInterval(pingId); ws.close(); };
}

export async function fetchSymbols(exchange: string): Promise<string[]> {
  const urls: Record<string, string> = {
    binance: "https://fapi.binance.com/fapi/v1/exchangeInfo",
    mexc: "https://contract.mexc.com/api/v1/contract/detail",
    gate: "https://api.gateio.ws/api/v4/futures/usdt/contracts",
    bybit: "https://api.bybit.com/v5/market/instruments-info?category=linear",
    kucoin: "https://api-futures.kucoin.com/api/v1/contracts/active",
    okx: "https://www.okx.com/api/v5/public/instruments?instType=SWAP",
  };
  const url = urls[exchange];
  if (!url) return [];
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return [];
  const data = await res.json();

  const norm = (s: string) => String(s).trim().toUpperCase().replace(/[-_]/g, "").replace(/\/USDT$/i, "") + "USDT";

  if (exchange === "binance") {
    return (data.symbols ?? []).filter((s: { status: string; contractType?: string }) => s.status === "TRADING" && s.contractType === "PERPETUAL").map((s: { symbol: string }) => norm(s.symbol));
  }
  if (exchange === "bybit") {
    return (data.result?.list ?? []).filter((s: { status: string }) => s.status === "Trading").map((s: { symbol: string }) => norm(s.symbol));
  }
  if (exchange === "gate") {
    return (data ?? []).filter((c: { in_delisting?: boolean }) => !c.in_delisting).map((c: { name?: string }) => norm(c.name ?? ""));
  }
  if (exchange === "mexc") {
    const list = data.data ?? data.list ?? data.contracts ?? [];
    return (Array.isArray(list) ? list : []).map((c: { symbol?: string }) => norm(c.symbol ?? ""));
  }
  if (exchange === "kucoin") {
    const list = data.data ?? [];
    return (Array.isArray(list) ? list : []).map((c: { symbol?: string }) => norm(c.symbol ?? ""));
  }
  if (exchange === "okx") {
    const list = data.data ?? [];
    return (Array.isArray(list) ? list : []).filter((i: { settleCcy?: string }) => i.settleCcy === "USDT").map((i: { instId?: string }) => norm((i.instId ?? "").replace(/-USDT-SWAP/, "")));
  }
  return [];
}
