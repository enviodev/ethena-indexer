import { indexer } from "envio";
import type {
  EvmOnEventContext,
  StakingStats,
  HourlyStakingFlow,
} from "envio";
import { ZERO_ADDRESS, LARGE_TRANSFER_THRESHOLD, hourStart } from "./common";

// ── Constants ─────────────────────────────────────────────────────────────

// USDeSilo — holds USDe during the sUSDe unstake cooldown. Read from
// StakedUSDeV2.silo() on mainnet. (checksummed)
export const USDE_SILO = "0x7FC7c91D556B400AFa565013E3F32055a0713425";

// Initial cooldownDuration the StakedUSDeV2 contract had at deployment.
//
// VERIFIED from the Sourcify-verified source of StakedUSDeV2
// (0x9D39A5DE30e57443BfF2A8307A4256c8797A3497):
//   uint24 public constant MAX_COOLDOWN_DURATION = 90 days;
//   constructor(...) { silo = new USDeSilo(...); cooldownDuration = MAX_COOLDOWN_DURATION; }
//
// The constructor sets cooldownDuration = 90 days SILENTLY — it does NOT emit
// CooldownDurationUpdated (only setCooldownDuration() emits that event). Since
// this indexer starts from block 0 it will never observe an event carrying the
// deployment value, so StakingStats must seed it here. 90 days = 7_776_000s.
const INITIAL_COOLDOWN_DURATION_SECONDS = 90n * 24n * 60n * 60n; // 7_776_000n

// ── SiloOutflow (claim-detector input, called from usde.ts) ────────────────

export type SiloOutflow = {
  to: string;
  amount: bigint;
  txFrom: string | undefined;
  blockNumber: number;
  timestamp: number;
  txHash: string;
  logIndex: number;
};

// ── Shared upsert helpers ──────────────────────────────────────────────────

// StakingStats singleton (id "global"). Seeds cooldownDurationSeconds with the
// deployment value (see note above); all other counters start at zero.
async function getOrCreateStakingStats(
  context: EvmOnEventContext,
): Promise<StakingStats> {
  return context.StakingStats.getOrCreate({
    id: "global",
    totalStakedUsde: 0n,
    susdeTotalSupply: 0n,
    pendingCooldownAmount: 0n,
    siloUsdeBalance: 0n,
    cumulativeRewards: 0n,
    cooldownDurationSeconds: INITIAL_COOLDOWN_DURATION_SECONDS,
    depositCount: 0,
    cooldownCount: 0,
    lastUpdatedTimestamp: 0n,
  });
}

// HourlyStakingFlow bucket, id = floor(ts/3600)*3600 as string.
async function getOrCreateHourly(
  context: EvmOnEventContext,
  timestamp: number,
): Promise<HourlyStakingFlow> {
  const bucket = hourStart(timestamp);
  return context.HourlyStakingFlow.getOrCreate({
    id: String(bucket),
    hourStartTimestamp: BigInt(bucket),
    usdeStaked: 0n,
    usdeCooldownStarted: 0n,
    usdeUnstaked: 0n,
    rewardsReceived: 0n,
    netFlow: 0n,
  });
}

// ── StakedUSDe (sUSDe) event handlers ──────────────────────────────────────

// Deposit(sender, owner, assets, shares): a stake into the vault.
indexer.onEvent(
  { contract: "StakedUSDe", event: "Deposit" },
  async ({ event, context }) => {
    const { sender, owner, assets, shares } = event.params;
    const ts = event.block.timestamp;

    context.StakeAction.set({
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      actionType: "DEPOSIT",
      account: owner,
      caller: sender,
      receiver: undefined,
      assets,
      shares,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(ts),
      txHash: event.transaction.hash,
    });

    const stats = await getOrCreateStakingStats(context);
    context.StakingStats.set({
      ...stats,
      totalStakedUsde: stats.totalStakedUsde + assets,
      depositCount: stats.depositCount + 1,
      lastUpdatedTimestamp: BigInt(ts),
    });

    const hourly = await getOrCreateHourly(context, ts);
    context.HourlyStakingFlow.set({
      ...hourly,
      usdeStaked: hourly.usdeStaked + assets,
      netFlow: hourly.netFlow + assets,
    });
  },
);

// Withdraw(sender, receiver, owner, assets, shares).
//
// When cooldown is ON (the mainnet default — duration 90d at deploy, currently
// 86400s), users exit via cooldownAssets/cooldownShares which call
// _withdraw(owner, address(silo), owner, assets, shares) → receiver == silo.
// This is NOT a real exit yet: the USDe is parked in the silo and becomes a
// forward liability (pendingCooldownAmount). A direct Withdraw (receiver != silo)
// is only reachable when cooldownDuration == 0.
indexer.onEvent(
  { contract: "StakedUSDe", event: "Withdraw" },
  async ({ event, context }) => {
    const { sender, receiver, owner, assets, shares } = event.params;
    const ts = event.block.timestamp;
    const id = `${event.chainId}_${event.block.number}_${event.logIndex}`;

    if (receiver === USDE_SILO) {
      // ── COOLDOWN_STARTED ──
      context.StakeAction.set({
        id,
        actionType: "COOLDOWN_STARTED",
        account: owner,
        caller: sender,
        receiver,
        assets,
        shares,
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(ts),
        txHash: event.transaction.hash,
      });

      const stats = await getOrCreateStakingStats(context);
      // Contract sets cooldownEnd = block.timestamp + cooldownDuration on EVERY
      // add (the end resets), while underlyingAmount accumulates. There is one
      // cooldown slot per owner (mapping keyed by owner).
      const cooldownEnd = BigInt(ts) + stats.cooldownDurationSeconds;

      const existing = await context.SusdeCooldown.get(owner);
      if (existing && existing.status === "ACTIVE") {
        context.SusdeCooldown.set({
          ...existing,
          underlyingAmount: existing.underlyingAmount + assets,
          cooldownEnd, // resets on each add
          lastTxHash: event.transaction.hash,
          // startedAt intentionally preserved from the first add
        });
      } else {
        // No prior cooldown, or the previous one was already CLAIMED (the
        // contract reuses the same owner slot after unstake zeroes it out).
        context.SusdeCooldown.set({
          id: owner,
          owner,
          underlyingAmount: assets,
          cooldownEnd,
          status: "ACTIVE",
          startedAt: BigInt(ts),
          claimedAt: undefined,
          lastTxHash: event.transaction.hash,
        });
      }

      context.StakingStats.set({
        ...stats,
        totalStakedUsde: stats.totalStakedUsde - assets,
        pendingCooldownAmount: stats.pendingCooldownAmount + assets,
        cooldownCount: stats.cooldownCount + 1,
        lastUpdatedTimestamp: BigInt(ts),
      });

      const hourly = await getOrCreateHourly(context, ts);
      context.HourlyStakingFlow.set({
        ...hourly,
        usdeCooldownStarted: hourly.usdeCooldownStarted + assets,
        netFlow: hourly.netFlow - assets,
      });
    } else {
      // ── Direct WITHDRAW (only when cooldownDuration == 0) ──
      context.StakeAction.set({
        id,
        actionType: "WITHDRAW",
        account: owner,
        caller: sender,
        receiver,
        assets,
        shares,
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(ts),
        txHash: event.transaction.hash,
      });

      const stats = await getOrCreateStakingStats(context);
      context.StakingStats.set({
        ...stats,
        totalStakedUsde: stats.totalStakedUsde - assets,
        lastUpdatedTimestamp: BigInt(ts),
      });

      const hourly = await getOrCreateHourly(context, ts);
      context.HourlyStakingFlow.set({
        ...hourly,
        usdeUnstaked: hourly.usdeUnstaked + assets,
        netFlow: hourly.netFlow - assets,
      });
    }
  },
);

// RewardsReceived(amount): protocol yield transferred into the vault. Increases
// the value of every share; accrues to totalStakedUsde.
indexer.onEvent(
  { contract: "StakedUSDe", event: "RewardsReceived" },
  async ({ event, context }) => {
    const { amount } = event.params;
    const ts = event.block.timestamp;

    context.RewardsPayment.set({
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      amount,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(ts),
      txHash: event.transaction.hash,
    });

    const stats = await getOrCreateStakingStats(context);
    context.StakingStats.set({
      ...stats,
      cumulativeRewards: stats.cumulativeRewards + amount,
      totalStakedUsde: stats.totalStakedUsde + amount, // yield accrues to vault
      lastUpdatedTimestamp: BigInt(ts),
    });

    const hourly = await getOrCreateHourly(context, ts);
    context.HourlyStakingFlow.set({
      ...hourly,
      rewardsReceived: hourly.rewardsReceived + amount,
      // NOTE: rewards are deliberately NOT folded into netFlow. netFlow tracks
      // user-driven flow (stakes in, cooldowns/withdrawals out); vesting yield
      // is a separate accrual and would distort the flow signal.
    });
  },
);

// CooldownDurationUpdated(previousDuration, newDuration): admin retunes the
// cooldown window. newDuration is a uint24 (decoded as bigint).
indexer.onEvent(
  { contract: "StakedUSDe", event: "CooldownDurationUpdated" },
  async ({ event, context }) => {
    const { newDuration } = event.params;
    const stats = await getOrCreateStakingStats(context);
    context.StakingStats.set({
      ...stats,
      cooldownDurationSeconds: BigInt(newDuration),
      lastUpdatedTimestamp: BigInt(event.block.timestamp),
    });
  },
);

// Transfer(from, to, value): the sUSDe ERC-20 itself. Track share supply via
// mint (from zero) / burn (to zero), and flag whale transfers.
indexer.onEvent(
  { contract: "StakedUSDe", event: "Transfer" },
  async ({ event, context }) => {
    const { from, to, value } = event.params;
    const ts = event.block.timestamp;

    if (from === ZERO_ADDRESS || to === ZERO_ADDRESS) {
      const stats = await getOrCreateStakingStats(context);
      let supply = stats.susdeTotalSupply;
      if (from === ZERO_ADDRESS) supply += value; // mint
      if (to === ZERO_ADDRESS) supply -= value; // burn
      context.StakingStats.set({
        ...stats,
        susdeTotalSupply: supply,
        lastUpdatedTimestamp: BigInt(ts),
      });
    }

    if (value >= LARGE_TRANSFER_THRESHOLD) {
      context.LargeTransfer.set({
        id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
        token: "sUSDe",
        from,
        to,
        amount: value,
        txFrom: event.transaction.from,
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(ts),
        txHash: event.transaction.hash,
      });
    }
  },
);

// ── Silo balance accounting (called by src/handlers/usde.ts) ───────────────

// Ground-truth USDe balance of the silo from raw transfer accounting. Serves
// as the reconciliation signal for pendingCooldownAmount: the difference is
// donations into the silo plus any unattributed claims.
export async function handleSiloInflow(
  context: EvmOnEventContext,
  inflow: { amount: bigint; timestamp: number },
): Promise<void> {
  const stats = await getOrCreateStakingStats(context);
  context.StakingStats.set({
    ...stats,
    siloUsdeBalance: stats.siloUsdeBalance + inflow.amount,
    lastUpdatedTimestamp: BigInt(inflow.timestamp),
  });
}

// ── Claim detector (called by src/handlers/usde.ts on USDe silo outflow) ────

// When a user's cooldown matures they call StakedUSDeV2.unstake(receiver), which
// makes the silo transfer the FULL accumulated underlyingAmount of USDe to the
// receiver. There is no sUSDe event for this — the only on-chain signal is a
// USDe Transfer with from == silo. The USDe Transfer handler forwards each such
// outflow here so we can retire the matching ACTIVE cooldown.
export async function handleSiloOutflow(
  context: EvmOnEventContext,
  outflow: SiloOutflow,
): Promise<void> {
  const { to, amount, txFrom, blockNumber, timestamp, txHash, logIndex } =
    outflow;

  // unstake() on an empty cooldown slot still calls silo.withdraw(receiver, 0),
  // emitting a 0-value USDe transfer from the silo (frequent on mainnet). Not a
  // claim — ignore, and never let it match a 0-amount cooldown entry.
  if (amount === 0n) return;

  // Balance accounting is unconditional — it must stay exact even when the
  // cooldown attribution below fails.
  const preStats = await getOrCreateStakingStats(context);
  context.StakingStats.set({
    ...preStats,
    siloUsdeBalance: preStats.siloUsdeBalance - amount,
    lastUpdatedTimestamp: BigInt(timestamp),
  });

  // unstake() claims the whole cooldown, so the outflow amount equals the
  // cooldown's underlyingAmount exactly. Both fields are @index-queryable.
  const candidates = await context.SusdeCooldown.getWhere({
    underlyingAmount: { _eq: amount },
    status: { _eq: "ACTIVE" },
  });

  // Disambiguate. The cooldown is keyed by unstake()'s msg.sender — for a
  // direct EOA call that is the tx sender, so txFrom is the strongest owner
  // signal and must be tried BEFORE the receiver (an owner can unstake to an
  // arbitrary receiver, which may itself hold an equal-amount cooldown). Then
  // the receiver (covers contract-wallet owners unstaking to themselves), then
  // the sole candidate. Otherwise record the miss rather than guess (and never
  // throw — that would halt the whole indexer).
  const match =
    candidates.find((c) => c.id === txFrom) ??
    candidates.find((c) => c.id === to) ??
    (candidates.length === 1 ? candidates[0] : undefined);

  if (!match) {
    context.UnmatchedSiloOutflow.set({
      id: `${context.chain.id}_${blockNumber}_${logIndex}`,
      to,
      txFrom,
      amount,
      activeCandidates: candidates.length,
      blockNumber: BigInt(blockNumber),
      timestamp: BigInt(timestamp),
      txHash,
    });
    context.log.warn(
      `handleSiloOutflow: silo outflow of ${amount} USDe to ${to} (txFrom ${txFrom}, tx ${txHash}) matched ${candidates.length} ACTIVE cooldown(s); recorded as UnmatchedSiloOutflow.`,
    );
    return;
  }

  context.SusdeCooldown.set({
    ...match,
    status: "CLAIMED",
    claimedAt: BigInt(timestamp),
    lastTxHash: txHash,
  });

  const stats = await getOrCreateStakingStats(context);
  context.StakingStats.set({
    ...stats,
    pendingCooldownAmount: stats.pendingCooldownAmount - amount,
    lastUpdatedTimestamp: BigInt(timestamp),
  });

  context.StakeAction.set({
    // logIndex is the USDe Transfer's log index, so this id is globally unique.
    id: `${context.chain.id}_${blockNumber}_${logIndex}`,
    actionType: "UNSTAKE_CLAIMED",
    account: match.owner,
    caller: undefined,
    receiver: to,
    assets: amount,
    shares: undefined,
    blockNumber: BigInt(blockNumber),
    timestamp: BigInt(timestamp),
    txHash,
  });

  const hourly = await getOrCreateHourly(context, timestamp);
  context.HourlyStakingFlow.set({
    ...hourly,
    usdeUnstaked: hourly.usdeUnstaked + amount,
    // NOTE: netFlow is intentionally NOT changed here. The vault's asset outflow
    // was already booked at cooldown start (netFlow -= assets). The claim merely
    // moves the parked USDe out of the silo; counting it again double-counts.
  });
}
