import { indexer } from "envio";
import type {
  EvmOnEventContext,
  MintRedeemEvent,
  CustodyEvent,
} from "envio";
import { hourStart, getOrCreateProtocolStats } from "./common";

// ── shared constants & helpers ────────────────────────────────────────────

type FlowType = "MINT" | "REDEEM";
type MintingVersion = "V1" | "V2";

// Normalized input all four Mint/Redeem handlers funnel through so the handler
// bodies stay thin and every entity update lives in one place.
type MintRedeemInput = {
  flowType: FlowType;
  version: MintingVersion;
  // V2 only — indexed string, so this is the keccak topic hash of the order id.
  orderId: string | undefined;
  benefactor: string;
  beneficiary: string;
  // minter (Mint) or redeemer (Redeem)
  executor: string;
  collateralAsset: string;
  collateralAmount: bigint;
  usdeAmount: bigint;
  blockNumber: number;
  timestamp: number;
  logIndex: number;
  txHash: string;
};

async function applyMintRedeem(
  context: EvmOnEventContext,
  input: MintRedeemInput,
): Promise<void> {
  const isMint = input.flowType === "MINT";
  const blockNumber = BigInt(input.blockNumber);
  const timestamp = BigInt(input.timestamp);

  // 1. Immutable event row — the trading-desk tape entry.
  const mintRedeemEvent: MintRedeemEvent = {
    id: `${input.chainId}_${input.blockNumber}_${input.logIndex}`,
    flowType: input.flowType,
    version: input.version,
    orderId: input.orderId,
    benefactor: input.benefactor,
    beneficiary: input.beneficiary,
    executor: input.executor,
    collateralAsset: input.collateralAsset,
    collateralAmount: input.collateralAmount,
    usdeAmount: input.usdeAmount,
    blockNumber,
    timestamp,
    txHash: input.txHash,
  };
  context.MintRedeemEvent.set(mintRedeemEvent);

  // 2. Per-collateral running totals (id = collateral asset address).
  const collateral = await context.CollateralAssetStats.getOrCreate({
    id: input.collateralAsset,
    usdeMinted: 0n,
    usdeRedeemed: 0n,
    collateralDeposited: 0n,
    collateralWithdrawn: 0n,
    mintCount: 0,
    redeemCount: 0,
    lastUpdatedTimestamp: 0n,
  });
  context.CollateralAssetStats.set({
    ...collateral,
    usdeMinted: collateral.usdeMinted + (isMint ? input.usdeAmount : 0n),
    usdeRedeemed: collateral.usdeRedeemed + (isMint ? 0n : input.usdeAmount),
    collateralDeposited:
      collateral.collateralDeposited + (isMint ? input.collateralAmount : 0n),
    collateralWithdrawn:
      collateral.collateralWithdrawn + (isMint ? 0n : input.collateralAmount),
    mintCount: collateral.mintCount + (isMint ? 1 : 0),
    redeemCount: collateral.redeemCount + (isMint ? 0 : 1),
    lastUpdatedTimestamp: timestamp,
  });

  // 3. Hourly issuance flow bucket (id = hour-start unix seconds as string).
  const bucket = hourStart(input.timestamp);
  const hour = await context.HourlyFlow.getOrCreate({
    id: String(bucket),
    hourStartTimestamp: BigInt(bucket),
    usdeMinted: 0n,
    usdeRedeemed: 0n,
    netFlow: 0n,
    mintCount: 0,
    redeemCount: 0,
  });
  const usdeMinted = hour.usdeMinted + (isMint ? input.usdeAmount : 0n);
  const usdeRedeemed = hour.usdeRedeemed + (isMint ? 0n : input.usdeAmount);
  context.HourlyFlow.set({
    ...hour,
    usdeMinted,
    usdeRedeemed,
    netFlow: usdeMinted - usdeRedeemed,
    mintCount: hour.mintCount + (isMint ? 1 : 0),
    redeemCount: hour.redeemCount + (isMint ? 0 : 1),
  });

  // 4. Global protocol cumulative stats.
  const stats = await getOrCreateProtocolStats(context);
  context.ProtocolStats.set({
    ...stats,
    cumulativeUsdeMinted:
      stats.cumulativeUsdeMinted + (isMint ? input.usdeAmount : 0n),
    cumulativeUsdeRedeemed:
      stats.cumulativeUsdeRedeemed + (isMint ? 0n : input.usdeAmount),
    mintCount: stats.mintCount + (isMint ? 1 : 0),
    redeemCount: stats.redeemCount + (isMint ? 0 : 1),
    lastUpdatedTimestamp: timestamp,
  });
}

type CustodyInput = {
  version: MintingVersion;
  wallet: string;
  asset: string;
  amount: bigint;
  blockNumber: number;
  timestamp: number;
  logIndex: number;
  txHash: string;
};

function applyCustody(
  context: EvmOnEventContext,
  input: CustodyInput,
): void {
  const custodyEvent: CustodyEvent = {
    id: `${input.chainId}_${input.blockNumber}_${input.logIndex}`,
    version: input.version,
    wallet: input.wallet,
    asset: input.asset,
    amount: input.amount,
    blockNumber: BigInt(input.blockNumber),
    timestamp: BigInt(input.timestamp),
    txHash: input.txHash,
  };
  context.CustodyEvent.set(custodyEvent);
}

// ── EthenaMintingV1 ───────────────────────────────────────────────────────

indexer.onEvent(
  { contract: "EthenaMintingV1", event: "Mint" },
  async ({ event, context }) => {
    await applyMintRedeem(context, {
      flowType: "MINT",
      version: "V1",
      orderId: undefined,
      benefactor: event.params.benefactor,
      beneficiary: event.params.beneficiary,
      executor: event.params.minter,
      collateralAsset: event.params.collateral_asset,
      collateralAmount: event.params.collateral_amount,
      usdeAmount: event.params.usde_amount,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "EthenaMintingV1", event: "Redeem" },
  async ({ event, context }) => {
    await applyMintRedeem(context, {
      flowType: "REDEEM",
      version: "V1",
      orderId: undefined,
      benefactor: event.params.benefactor,
      beneficiary: event.params.beneficiary,
      executor: event.params.redeemer,
      collateralAsset: event.params.collateral_asset,
      collateralAmount: event.params.collateral_amount,
      usdeAmount: event.params.usde_amount,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "EthenaMintingV1", event: "CustodyTransfer" },
  async ({ event, context }) => {
    applyCustody(context, {
      version: "V1",
      wallet: event.params.wallet,
      asset: event.params.asset,
      amount: event.params.amount,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
    });
  },
);

// ── EthenaMintingV2 ───────────────────────────────────────────────────────

indexer.onEvent(
  { contract: "EthenaMintingV2", event: "Mint" },
  async ({ event, context }) => {
    await applyMintRedeem(context, {
      flowType: "MINT",
      version: "V2",
      orderId: event.params.order_id,
      benefactor: event.params.benefactor,
      beneficiary: event.params.beneficiary,
      executor: event.params.minter,
      collateralAsset: event.params.collateral_asset,
      collateralAmount: event.params.collateral_amount,
      usdeAmount: event.params.usde_amount,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "EthenaMintingV2", event: "Redeem" },
  async ({ event, context }) => {
    await applyMintRedeem(context, {
      flowType: "REDEEM",
      version: "V2",
      orderId: event.params.order_id,
      benefactor: event.params.benefactor,
      beneficiary: event.params.beneficiary,
      executor: event.params.redeemer,
      collateralAsset: event.params.collateral_asset,
      collateralAmount: event.params.collateral_amount,
      usdeAmount: event.params.usde_amount,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "EthenaMintingV2", event: "CustodyTransfer" },
  async ({ event, context }) => {
    applyCustody(context, {
      version: "V2",
      wallet: event.params.wallet,
      asset: event.params.asset,
      amount: event.params.amount,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
    });
  },
);
