// Integration registry: classifies known USDe/sUSDe holder contracts into
// "opportunities" (the yield venues app.ethena.fi/opportunities surfaces).
// Every address must be verified on-chain to actually hold USDe or sUSDe.

export type OpportunityCategory =
  | "money-market" // Aave, Fluid, Euler, ...
  | "dex-pool" // Curve, Uniswap, ...
  | "yield-tokenization" // Pendle SY/markets
  | "vault" // ERC-4626 wrappers, Ethena's own staking
  | "cex" // labeled exchange custody wallets
  | "bridge" // canonical/third-party bridge escrows
  | "perps" // perp DEX collateral (Ethereal, HyENA-adjacent)
  | "other";

export type RegistryEntry = {
  // unique, stable slug — also the Opportunity entity id
  slug: string;
  name: string;
  protocol: string; // lowercase protocol key, e.g. "aave", "pendle"
  category: OpportunityCategory;
  chainId: number;
  // CHECKSUMMED address of the contract/wallet that holds the tokens
  address: string;
};

export const REGISTRY: RegistryEntry[] = [
  // Seed entry — DO NOT REMOVE (tests depend on it): the sUSDe vault is the
  // single largest USDe holder on mainnet.
  {
    slug: "ethena-susde-staking-ethereum",
    name: "Ethena sUSDe staking (Ethereum)",
    protocol: "ethena",
    category: "vault",
    chainId: 1,
    address: "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497",
  },
];

// chainId → lowercased holder address → entry. Lowercased so lookups are
// case-insensitive regardless of the caller's address formatting.
const byChain = new Map<number, Map<string, RegistryEntry>>();
for (const entry of REGISTRY) {
  let m = byChain.get(entry.chainId);
  if (!m) {
    m = new Map();
    byChain.set(entry.chainId, m);
  }
  m.set(entry.address.toLowerCase(), entry);
}

export function lookupOpportunity(
  chainId: number,
  address: string,
): RegistryEntry | undefined {
  return byChain.get(chainId)?.get(address.toLowerCase());
}
