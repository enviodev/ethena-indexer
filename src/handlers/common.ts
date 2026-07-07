import type { EvmOnEventContext, ProtocolStats } from "envio";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Whale watchlist threshold, shared by the USDe and sUSDe LargeTransfer feeds
// (both tokens are 18 decimals).
export const LARGE_TRANSFER_THRESHOLD = 1_000_000n * 10n ** 18n;

// Hour bucket both HourlyFlow and HourlyStakingFlow key on: floor to the hour,
// unix seconds. Keep in sync so the two tables join on id/timestamp.
export function hourStart(timestamp: number): number {
  return Math.floor(timestamp / 3600) * 3600;
}

// ProtocolStats singleton — seeded here so every writer (minting.ts, usde.ts)
// agrees on initial state.
export async function getOrCreateProtocolStats(
  context: EvmOnEventContext,
): Promise<ProtocolStats> {
  return context.ProtocolStats.getOrCreate({
    id: "global",
    usdeTotalSupply: 0n,
    cumulativeUsdeMinted: 0n,
    cumulativeUsdeRedeemed: 0n,
    mintCount: 0,
    redeemCount: 0,
    lastUpdatedTimestamp: 0n,
  });
}
