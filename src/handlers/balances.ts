import type { EvmOnEventContext } from "envio";

export type TokenTag = "USDe" | "sUSDe";

export type TransferLike = {
  chainId: number;
  token: TokenTag;
  from: string; // checksummed, as decoded from the event
  to: string;
  value: bigint;
  timestamp: number;
};

// Called for EVERY USDe/sUSDe Transfer on every indexed chain (by usde.ts,
// staking.ts and the OFT handlers). Maintains:
//  - TokenBalance per (chain, token, holder), zero address excluded
//  - ChainSupply per (chain, token) from mints/burns
//  - Opportunity TVL aggregates + hourly snapshots for registry-classified holders
export async function trackTransfer(
  context: EvmOnEventContext,
  transfer: TransferLike,
): Promise<void> {
  // Implemented alongside the Opportunities backend (balances module).
}
