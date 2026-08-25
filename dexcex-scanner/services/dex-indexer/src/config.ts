/**
 * DEX Indexer — chain and protocol config
 * Uniswap V2–style: PairCreated, Swap, Sync, Mint, Burn
 */

export const PAIR_CREATED_TOPIC = "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9";
export const SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8cd5aeaa3c7e0e4e2d4";
export const SYNC_TOPIC = "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";
export const MINT_TOPIC = "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f";
export const BURN_TOPIC = "0xcc16f5dbb4873280815c1ee09dbd06fdf588487495c1ba3c6d8b181f736378a6";

export const CHAINS: Record<string, { rpc: string; chainId?: number }> = {
  ethereum: { rpc: "https://eth.llamarpc.com", chainId: 1 },
  bsc: { rpc: "https://bsc-dataseed.binance.org", chainId: 56 },
  arbitrum: { rpc: "https://arb1.arbitrum.io/rpc", chainId: 42161 },
  polygon: { rpc: "https://polygon-rpc.com", chainId: 137 },
  base: { rpc: "https://mainnet.base.org", chainId: 8453 },
  optimism: { rpc: "https://mainnet.optimism.io", chainId: 10 },
  avalanche: { rpc: "https://api.avax.network/ext/bc/C/rpc", chainId: 43114 },
};

export const DEX_PROTOCOLS: Array<{ chain: string; protocol: string; factory: string }> = [
  { chain: "ethereum", protocol: "uniswap_v2", factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f" },
  { chain: "ethereum", protocol: "sushiswap", factory: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac" },
  { chain: "bsc", protocol: "pancakeswap_v2", factory: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73" },
  { chain: "arbitrum", protocol: "sushiswap", factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4" },
  { chain: "polygon", protocol: "sushiswap", factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4" },
  { chain: "base", protocol: "aerodrome", factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" },
];

export const USDT_ADDRESSES = new Set([
  "0xdac17f958d2ee523a2206206994597c13d831ec7", // ETH
  "0x55d398326f99059ff775485246999027b3197955", // BSC
  "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", // Arbitrum
  "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", // Polygon
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base
  "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7", // Avalanche
]);
