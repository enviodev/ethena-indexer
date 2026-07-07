import { indexer } from "envio";
import type { EvmOnEventContext } from "envio";
import { trackTransfer } from "./balances";
import type { TokenTag } from "./balances";
import { recordLargeTransfer } from "./common";
import type { TransferEventLike } from "./common";

// LayerZero OFT deployments of USDe/sUSDe on the L2s (Arbitrum, Base, BNB,
// Mantle, HyperEVM). A cross-chain send burns on the source OFT and mints on
// the destination OFT, so from/to == 0x0 legs show up here exactly like native
// mint/burn — trackTransfer folds them into per-chain ChainSupply.

// Shared body for both OFT Transfer feeds: feed the balance/supply/TVL engine,
// then record whale transfers. The two events are structurally identical, so
// one helper keeps the per-transfer path lean across all 6 chains.
async function handleOftTransfer(
  context: EvmOnEventContext,
  token: TokenTag,
  event: TransferEventLike,
): Promise<void> {
  const { from, to, value } = event.params;

  await trackTransfer(context, {
    chainId: event.chainId,
    token,
    from,
    to,
    value,
    timestamp: event.block.timestamp,
  });

  recordLargeTransfer(context, token, event);
}

indexer.onEvent(
  { contract: "UsdeOFT", event: "Transfer" },
  async ({ event, context }) => {
    await handleOftTransfer(context, "USDe", event);
  },
);

indexer.onEvent(
  { contract: "SusdeOFT", event: "Transfer" },
  async ({ event, context }) => {
    await handleOftTransfer(context, "sUSDe", event);
  },
);
