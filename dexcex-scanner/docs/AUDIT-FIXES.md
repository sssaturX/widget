# DEX-CEX Scanner — Audit Fixes

## CRITICAL (исправлено)

### 1. NATS: publish vs subscribe
**Проблема:** `js.publish()` (JetStream) не доставлял сообщения подписчикам `nc.subscribe()` (core NATS).

**Решение:** Все издатели переведены на `nc.publish()` для доставки в реальном времени.

### 2. Risk-engine: маршрутизация RPC по chain
**Проблема:** `eth_getCode` вызывался без указания chain; rpc-gateway всегда использовал Ethereum.

**Решение:** В запросе передаётся `id: "chain:" + chain`; rpc-gateway извлекает chain и маршрутизирует на нужный RPC.

### 3. NATS healthcheck
**Проблема:** Healthcheck проверял порт 8222, при `-m 8223` мониторинг на 8223.

**Решение:** Healthcheck переведён на `http://localhost:8223/healthz`, порты `8223:8223`.

### 4. Stream creation race
**Проблема:** Издатели могли стартовать до создания JetStream stream.

**Решение:** Используется core NATS (`nc.publish`), stream не требуется для доставки.

---

## HIGH (исправлено)

### 5. RPC-gateway: graceful shutdown
**Решение:** Добавлены обработчики SIGTERM/SIGINT с закрытием HTTP-серверов.

### 6. CEX connectors: setInterval не очищался
**Решение:** Сохраняем ID интервала, в `stop()` вызываем `clearInterval()` перед `ws.close()`.

### 7. Unbounded maps
**Решение:**
- **spread-engine:** TTL-эвикция для cexPrices (60s), dexPrices (120s), riskScores (10min)
- **risk-engine:** Периодическая очистка cache (каждые 60s)
- **dex-indexer:** Лимит poolTokens 50k, эвикция при превышении

### 8. fetchSymbols timeout
**Решение:** Добавлен `AbortSignal.timeout(15_000)` для fetch.

---

## Рекомендации (не реализовано)

- **dex-indexer:** Retry с backoff для RPC
- **spread-engine:** Retry для registry fetch
- **Aerodrome:** Проверить совместимость событий с Uniswap V2
