import { indexer } from "envio";
import type { LargeTransfer } from "envio";
import { USDE_SILO, handleSiloInflow, handleSiloOutflow } from "./staking";
import {
  ZERO_ADDRESS,
  LARGE_TRANSFER_THRESHOLD,
  getOrCreateProtocolStats,
} from "./common";

// This handler runs for EVERY USDe transfer (millions over the token's
// history) — a conscious cost: the whale watchlist keys on `value`, which is
// not an indexed topic, so the event stream cannot be pre-filtered at the data
// layer. The supply / silo branches alone would be topic-filterable. HyperSync
// replays the full history in minutes, so the trade is acceptable.
indexer.onEvent(
  { contract: "USDe", event: "Transfer" },
  async ({ event, context }) => {
    const { from, to, value } = event.params;

    // Track circulating supply via mint (from == 0x0) and burn (to == 0x0).
    if (from === ZERO_ADDRESS || to === ZERO_ADDRESS) {
      const stats = await getOrCreateProtocolStats(context);
      let usdeTotalSupply = stats.usdeTotalSupply;
      if (from === ZERO_ADDRESS) usdeTotalSupply += value;
      if (to === ZERO_ADDRESS) usdeTotalSupply -= value;
      context.ProtocolStats.set({
        ...stats,
        usdeTotalSupply,
        lastUpdatedTimestamp: BigInt(event.block.timestamp),
      });
    }

    // Whale watch: record USDe transfers at or above the threshold.
    if (value >= LARGE_TRANSFER_THRESHOLD) {
      const largeTransfer: LargeTransfer = {
        id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
        token: "USDe",
        from,
        to,
        amount: value,
        txFrom: event.transaction.from,
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(event.block.timestamp),
        txHash: event.transaction.hash,
      };
      context.LargeTransfer.set(largeTransfer);
    }

    // Silo balance accounting: USDe entering the cooldown silo.
    if (to === USDE_SILO) {
      await handleSiloInflow(context, {
        amount: value,
        timestamp: event.block.timestamp,
      });
    }

    // USDe leaving the cooldown silo == an unstake claim. Hand off to the
    // staking half, which closes the matching SusdeCooldown.
    if (from === USDE_SILO) {
      await handleSiloOutflow(context, {
        to,
        amount: value,
        txFrom: event.transaction.from,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
        txHash: event.transaction.hash,
        logIndex: event.logIndex,
      });
    }
  },
);
