import type { EvmOnEventContext } from "envio";
import { ZERO_ADDRESS, hourStart } from "./common";
import { isYieldCategory, lookupOpportunity } from "./registry";

export type TokenTag = "USDe" | "sUSDe";

export type TransferLike = {
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
  const { chainId, token, from, to, value, timestamp } = transfer;

  // 0-value transfers move nothing and change no supply — bail before writing
  // any rows (mainnet + 6 chains emit these constantly; they'd be pure junk).
  if (value === 0n) return;

  const isMint = from === ZERO_ADDRESS;
  const isBurn = to === ZERO_ADDRESS;

  // ChainSupply: mint (from 0x0) grows circulating supply, burn (to 0x0)
  // shrinks it. Plain transfers leave supply untouched, so we only read/write
  // the row on mint/burn.
  if (isMint || isBurn) {
    const supply = await context.ChainSupply.getOrCreate({
      id: `${chainId}_${token}`,
      chainId,
      token,
      totalSupply: 0n,
      lastUpdatedTimestamp: 0n,
    });
    let totalSupply = supply.totalSupply;
    if (isMint) totalSupply += value;
    if (isBurn) totalSupply -= value;
    context.ChainSupply.set({
      ...supply,
      totalSupply,
      lastUpdatedTimestamp: BigInt(timestamp),
    });
  }

  // Holder balances. Process `from` THEN `to` SEQUENTIALLY: a self-transfer
  // (from == to) must net to zero, which only holds because the `to` side's
  // getOrCreate reads the `from` side's in-memory write. Do NOT parallelize.
  if (!isMint) {
    await applyBalanceChange(context, transfer, from, -value);
  }
  if (!isBurn) {
    await applyBalanceChange(context, transfer, to, value);
  }
}

// Applies a signed delta (+value inflow / -value outflow) to one holder's
// TokenBalance, and — when that holder is a classified integration — to the
// matching Opportunity aggregate and its end-of-hour snapshot.
async function applyBalanceChange(
  context: EvmOnEventContext,
  transfer: TransferLike,
  holder: string,
  delta: bigint,
): Promise<void> {
  const { chainId, token, timestamp } = transfer;
  const ts = BigInt(timestamp);

  const entry = lookupOpportunity(chainId, holder);

  const balance = await context.TokenBalance.getOrCreate({
    id: `${chainId}_${token}_${holder}`,
    chainId,
    token,
    holder,
    balance: 0n,
    opportunitySlug: undefined,
    lastUpdatedTimestamp: 0n,
  });
  context.TokenBalance.set({
    ...balance,
    balance: balance.balance + delta,
    // Stamp the classification once known; leave any prior value otherwise.
    opportunitySlug: entry ? entry.slug : balance.opportunitySlug,
    lastUpdatedTimestamp: ts,
  });

  if (!entry) return;

  // Live TVL for the integration this holder belongs to.
  const opp = await context.Opportunity.getOrCreate({
    id: entry.slug,
    name: entry.name,
    protocol: entry.protocol,
    category: entry.category,
    isYieldVenue: isYieldCategory(entry.category),
    usdeBalance: 0n,
    susdeBalance: 0n,
    lastUpdatedTimestamp: 0n,
  });
  const usdeBalance =
    token === "USDe" ? opp.usdeBalance + delta : opp.usdeBalance;
  const susdeBalance =
    token === "sUSDe" ? opp.susdeBalance + delta : opp.susdeBalance;
  context.Opportunity.set({
    ...opp,
    usdeBalance,
    susdeBalance,
    lastUpdatedTimestamp: ts,
  });

  // Hourly snapshot keyed by slug + hour bucket. We overwrite the whole row
  // with the CURRENT post-update balances, so the last transfer in the hour
  // wins — i.e. this is an end-of-hour reading of the opportunity's TVL.
  const bucket = hourStart(timestamp);
  context.OpportunityHourlySnapshot.set({
    id: `${entry.slug}_${bucket}`,
    opportunitySlug: entry.slug,
    hourStartTimestamp: BigInt(bucket),
    usdeBalance,
    susdeBalance,
  });
}
