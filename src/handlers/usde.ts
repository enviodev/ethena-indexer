import { indexer } from "envio";
import { USDE_SILO, handleSiloInflow, handleSiloOutflow } from "./staking";
import { trackTransfer } from "./balances";
import {
  ZERO_ADDRESS,
  getOrCreateProtocolStats,
  recordLargeTransfer,
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

    // Opportunities backend: per-holder balances, per-chain supply and
    // integration TVL. Mainnet ChainSupply(1_USDe) intentionally duplicates
    // ProtocolStats.usdeTotalSupply — that's by design, a uniform per-chain
    // view of supply that also covers the L2 OFT deployments.
    await trackTransfer(context, {
      token: "USDe",
      from,
      to,
      value,
      timestamp: event.block.timestamp,
    });

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
    recordLargeTransfer(context, "USDe", event);

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
