import type { EvmOnEventContext } from "envio";

// USDeSilo — holds USDe during the sUSDe unstake cooldown. Read from
// StakedUSDeV2.silo() on mainnet.
export const USDE_SILO = "0x7FC7c91D556B400AFa565013E3F32055a0713425";

export type SiloOutflow = {
  to: string;
  amount: bigint;
  txFrom: string | undefined;
  blockNumber: number;
  timestamp: number;
  txHash: string;
  logIndex: number;
};

// Called by the USDe Transfer handler (src/handlers/usde.ts) whenever USDe
// leaves the silo — i.e. a cooldown unstake claim. Marks the matching
// SusdeCooldown as CLAIMED and records an UNSTAKE_CLAIMED StakeAction.
export async function handleSiloOutflow(
  context: EvmOnEventContext,
  outflow: SiloOutflow,
): Promise<void> {
  // Implemented alongside the sUSDe staking handlers.
}
