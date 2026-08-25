# Security

This scanner **does not place orders**. It reads public DEX/CEX market data and emits signals over NATS.

## Secrets

- Copy `.env.example` to `.env`. Never commit `.env`.
- RPC API keys (`RPC_ETHEREUM`, …) belong only in `.env` or your orchestrator secret store.
- The CEX connectors use **public** websocket/REST endpoints. Do not add exchange API keys to this repo unless you are adding opt-in execution (fail-closed, dry-run default).

## Network

- Bind the API to localhost in development (`127.0.0.1:3002`).
- Set `CORS_ORIGINS` in production. Unset CORS allows all origins (dev default).
- Public RPC URLs in `rpc-gateway` are fallbacks. They rate-limit and can return HTML; prefer keyed endpoints.

## Reporting

Open a GitHub issue. Do not file on-chain exploits against third-party protocols here.
