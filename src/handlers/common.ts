import type { EvmOnEventContext, ProtocolStats } from "envio";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Whale watchlist threshold, shared by the USDe and sUSDe LargeTransfer feeds
// (both tokens are 18 decimals).
export const LARGE_TRANSFER_THRESHOLD = 1_000_000n * 10n ** 18n;

// Structural shape of a Transfer event as every handler receives it — lets one
// writer serve the native USDe/sUSDe handlers and the OFT handlers alike.
export type TransferEventLike = {
  logIndex: number;
  params: { from: string; to: string; value: bigint };
  block: { number: number; timestamp: number };
  transaction: { from?: string | undefined; hash: string };
};

// Whale watch: the single LargeTransfer writer for all three Transfer feeds
// (usde.ts, staking.ts, oft.ts) so the row shape can't drift between them.
// The threshold keys on the raw value, which is not an indexed topic — this is
// why the Transfer streams can't be pre-filtered at the data layer.
export function recordLargeTransfer(
  context: EvmOnEventContext,
  token: "USDe" | "sUSDe",
  event: TransferEventLike,
): void {
  if (event.params.value < LARGE_TRANSFER_THRESHOLD) return;
  context.LargeTransfer.set({
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    token,
    from: event.params.from,
    to: event.params.to,
    amount: event.params.value,
    txFrom: event.transaction.from,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
}

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
