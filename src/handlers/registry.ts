// Integration registry: classifies known USDe/sUSDe holder contracts into
// "opportunities" (the yield venues app.ethena.fi/opportunities surfaces).
// Every address must be verified on-chain to actually hold USDe or sUSDe.
//
// All balances quoted below were verified on-chain on 2026-07-07 against the
// chain's USDe/sUSDe token; the balanceOf threshold for inclusion is ~100k
// tokens, with a handful of clearly-labeled sub-threshold venues kept on the
// smaller chains (Mantle/HyperEVM/Arbitrum) for coverage — those are noted.
// Unidentified whale EOAs / anonymous multisigs are intentionally excluded:
// this registry maps *venues*, not every large holder.

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
  // CHECKSUMMED address of the contract/wallet that holds the tokens
  address: string;
};

export const REGISTRY: RegistryEntry[] = [
  // --- Ethereum (1) ---
  // Cross-chain escrows: the LayerZero OFT adapters lock the USDe/sUSDe that
  // circulates on every other chain — by far the two largest single holders.
  { slug: "ethena-usde-bridge-ethereum", name: "Ethena USDe Bridge (LayerZero OFT Adapter)", protocol: "ethena", category: "bridge", address: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34" },
  { slug: "ethena-susde-bridge-ethereum", name: "Ethena sUSDe Bridge (LayerZero OFT Adapter)", protocol: "ethena", category: "bridge", address: "0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2" },
  // Seed entry — DO NOT REMOVE (tests depend on it): the sUSDe vault is the
  // single largest USDe holder on mainnet (holds the staking backing).
  { slug: "ethena-susde-staking-ethereum", name: "Ethena sUSDe staking (Ethereum)", protocol: "ethena", category: "vault", address: "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497" },
  // USDeSilo: holds USDe queued during the sUSDe cooldown window.
  { slug: "ethena-usde-cooldown-silo-ethereum", name: "Ethena USDe cooldown silo", protocol: "ethena", category: "other", address: "0x7FC7c91D556B400AFa565013E3F32055a0713425" },
  { slug: "aave-v3-usde-ethereum", name: "Aave v3 USDe (aEthUSDe)", protocol: "aave", category: "money-market", address: "0x4F5923Fc5FD4a93352581b38B7cD26943012DECF" },
  { slug: "aave-v3-susde-ethereum", name: "Aave v3 sUSDe (aEthsUSDe)", protocol: "aave", category: "money-market", address: "0x4579a27aF00A62C0EB156349f31B345c08386419" },
  // Morpho Blue is a singleton: this one contract holds every Morpho market's
  // sUSDe/USDe liquidity on the chain (~65M sUSDe on mainnet).
  { slug: "morpho-blue-ethereum", name: "Morpho Blue (all Ethereum markets)", protocol: "morpho", category: "money-market", address: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" },
  { slug: "fluid-liquidity-ethereum", name: "Fluid (Instadapp) Liquidity layer", protocol: "fluid", category: "money-market", address: "0x52Aa899454998Be5b000Ad077a46Bbe360F4e497" },
  // Pendle SYs: each maturity/deployment is its own contract holding the
  // underlying; the largest (…bf98) holds ~31M sUSDe.
  { slug: "pendle-sy-susde-bf98-ethereum", name: "Pendle SY-sUSDe", protocol: "pendle", category: "yield-tokenization", address: "0xBF98480425A29197e5d99D003017f63a1e595D02" },
  { slug: "pendle-sy-usde-f3db-ethereum", name: "Pendle SY-USDe", protocol: "pendle", category: "yield-tokenization", address: "0xf3DbdE762E5B67FaD09d88da3dfD38A83f753FFe" },
  { slug: "pendle-sy-susde-50cb-ethereum", name: "Pendle SY-sUSDe", protocol: "pendle", category: "yield-tokenization", address: "0x50CBf8837791aB3D8dcfB3cE3d1B0d128e1105d4" },
  { slug: "pendle-sy-susde-c01c-ethereum", name: "Pendle SY-sUSDe", protocol: "pendle", category: "yield-tokenization", address: "0xC01cde799245a25e6EabC550b36A47F6F83cc0f1" },
  { slug: "pendle-sy-usde-f0ba-ethereum", name: "Pendle SY-USDe", protocol: "pendle", category: "yield-tokenization", address: "0xf0bAcD9C3D94fC924DBcaaF644208C4E3f4d3bB4" },
  { slug: "pendle-sy-usde-4286-ethereum", name: "Pendle SY-USDe", protocol: "pendle", category: "yield-tokenization", address: "0x42862F48eAdE25661558AFE0A630b132038553D0" },
  { slug: "pendle-sy-usde-925a-ethereum", name: "Pendle SY-USDe", protocol: "pendle", category: "yield-tokenization", address: "0x925a15bD6A1582fa7c0EbbFc3Dbd29c34f58340e" },
  { slug: "curve-frax-usde-ethereum", name: "Curve FRAX/USDe pool", protocol: "curve", category: "dex-pool", address: "0x5dc1BF6f1e983C0b21EfB003c105133736fA0743" },
  { slug: "curve-dola-susde-ethereum", name: "Curve DOLA/sUSDe pool", protocol: "curve", category: "dex-pool", address: "0x744793B5110f6ca9cC7CDfe1CE16677c3Eb192ef" },
  { slug: "curve-sdai-susde-ethereum", name: "Curve sDAI/sUSDe pool", protocol: "curve", category: "dex-pool", address: "0x167478921b907422F8E88B43C4Af2B8BEa278d3A" },
  { slug: "curve-reusd-susde-ethereum", name: "Curve reUSD/sUSDe pool", protocol: "curve", category: "dex-pool", address: "0x5C2ab69Eb2BF12A2f4572D178687Bd4660512972" },
  { slug: "curve-scrvusd-susde-ethereum", name: "Curve scrvUSD/sUSDe pool (LlamaThena)", protocol: "curve", category: "dex-pool", address: "0xd29f8980852c2c76fC3f6E96a7Aa06E0BedCC1B1" },
  // Uniswap v4 is a singleton PoolManager holding all v4 pools' tokens.
  { slug: "uniswap-v4-usde-ethereum", name: "Uniswap v4 PoolManager (Ethereum)", protocol: "uniswap", category: "dex-pool", address: "0x000000000004444c5dc75cB358380D2e3dE08A90" },
  { slug: "ethereal-eusde-vault-ethereum", name: "Ethereal eUSDe pre-deposit vault", protocol: "ethereal", category: "perps", address: "0x90D2af7d622ca3141efA4d8f1F24d86E5974Cc8F" },
  { slug: "cian-susde-ethereum", name: "CIAN Yield Layer sUSDe vault", protocol: "cian", category: "vault", address: "0x9fFe77146Cc1DA3Edb87af163C6C32BAB474B464" },
  { slug: "cian-susde-2-ethereum", name: "CIAN Yield Layer sUSDe vault (2)", protocol: "cian", category: "vault", address: "0xB3e6FC32cD058A1DD5aC8b0246e1701737764399" },
  { slug: "strata-susde-ethereum", name: "Strata sUSDe Strategy", protocol: "strata", category: "vault", address: "0xdbf4FB6C310C1C85D0b41B5DbCA06096F2E7099F" },
  { slug: "olympus-treasury-susde-ethereum", name: "Olympus DAO Treasury (sUSDe holdings)", protocol: "olympus", category: "other", address: "0xa8687A15D4BE32CC8F0a8a7B9704a4C3993D9613" },
  { slug: "re-redemption-vault-susde-ethereum", name: "Re Protocol RedemptionVault", protocol: "re", category: "vault", address: "0x5C454f5526e41fBE917b63475CD8CA7E4631B147" },
  { slug: "re-reusd-custodial-susde-ethereum", name: "Re Protocol reUSD custodial wallet", protocol: "re", category: "other", address: "0x295F67Fdb21255A3Db82964445628a706FBe689E" },
  // CEX custody — the largest labeled exchange wallets holding USDe on mainnet.
  { slug: "mexc-custody-ethereum", name: "MEXC custody wallet", protocol: "mexc", category: "cex", address: "0x3CC936b795A188F0e246cBB2D74C5Bd190aeCF18" },
  { slug: "bybit-25-ethereum", name: "Bybit custody (Bybit 25)", protocol: "bybit", category: "cex", address: "0x63beE4A7e4aa5d76Dc6AB9b9d1852AABB9a40936" },
  // Untagged but Bybit-funded (same funder + timestamp as Bybit 25) — medium confidence.
  { slug: "bybit-custody-2-ethereum", name: "Bybit custody (untagged, Bybit-funded)", protocol: "bybit", category: "cex", address: "0x33AE83071432116AE892693b45466949a38Ac74C" },
  { slug: "kraken-custody-ethereum", name: "Kraken Hot Wallet 3", protocol: "kraken", category: "cex", address: "0xcC282E2004428939ee5149A9e7872F0B4d5d5ec7" },
  { slug: "bybit-19-ethereum", name: "Bybit custody (Bybit 19)", protocol: "bybit", category: "cex", address: "0x4865d4bCf4AB92e1c9ba5011560E7D4c36f54106" },
  { slug: "ceffu-custody-ethereum", name: "Ceffu custody (Ceffu 2)", protocol: "ceffu", category: "cex", address: "0x3a3C006053a9B40286B9951A11bE4C5808c11dc8" },

  // --- Base (8453) ---
  // Base USDe is ~99% inside the Morpho Blue singleton.
  { slug: "morpho-blue-base", name: "Morpho Blue (all Base markets)", protocol: "morpho", category: "money-market", address: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" },
  { slug: "aerodrome-usde-usdc-base", name: "Aerodrome USDe/USDC pool", protocol: "aerodrome", category: "dex-pool", address: "0x15BC08D2E2B405afeD3fB872DCd2d962BcCfB7e0" },
  { slug: "uniswap-v3-usde-usdc-base", name: "Uniswap v3 USDe/USDC pool (Base)", protocol: "uniswap", category: "dex-pool", address: "0xedAf6Ca46FB852D4AB0A2e9449d267cf03213F05" },

  // --- BNB (56) ---
  // BNB USDe is ~99% custodied by Binance/Ceffu; sUSDe is dominated by Lista's
  // Moolah lending singleton and Venus.
  { slug: "binance-hot-20-bnb", name: "Binance Hot Wallet 20", protocol: "binance", category: "cex", address: "0xF977814e90dA44bFA03b6295A0616a897441aceC" },
  { slug: "binance-28-bnb", name: "Binance 28", protocol: "binance", category: "cex", address: "0x5a52E96BAcdaBb82fd05763E25335261B270Efcb" },
  { slug: "lista-moolah-susde-bnb", name: "Lista DAO Moolah lending (sUSDe)", protocol: "lista", category: "money-market", address: "0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C" },
  { slug: "venus-susde-bnb", name: "Venus vsUSDe (Core Pool)", protocol: "venus", category: "money-market", address: "0x699658323d58eE25c69F1a29d476946ab011bD18" },
  { slug: "ceffu-9-bnb", name: "Ceffu custody (Ceffu 9)", protocol: "ceffu", category: "cex", address: "0x08439901c2bB071cd0812eD329675C9657434083" },

  // --- Mantle (5000) ---
  // ~98% of Mantle sUSDe (~$173M) sits in the Aave Mantle sUSDe aToken.
  { slug: "aave-v3-susde-mantle", name: "Aave v3 Mantle sUSDe (aMansUSDe)", protocol: "aave", category: "money-market", address: "0xaf972F332FF79bd32A6CB6B54f903eA0F9b16C2a" },
  { slug: "aave-v3-usde-mantle", name: "Aave v3 Mantle USDe (aManUSDe)", protocol: "aave", category: "money-market", address: "0xb9aCA933C9c0aa854a6DBb7b12f0CC3FdaC15ee7" },
  { slug: "compound-v3-usde-mantle", name: "Compound v3 USDe market (cUSDev3)", protocol: "compound", category: "money-market", address: "0x606174f62cd968d8e684c645080fa694c1D7786E" },
  { slug: "merchant-moe-usde-mantle", name: "Merchant Moe Liquidity Book USDe pair", protocol: "merchant-moe", category: "dex-pool", address: "0x5A59359a1ad9b0A59aa70145dFeCeb6d9Ee07253" },
  { slug: "agni-usde-mantle", name: "Agni Finance USDe pool", protocol: "agni", category: "dex-pool", address: "0xBCf99c834E65E8a58090E20eDc058279317865BD" },
  // Below the ~100k threshold (~84k USDe) but kept as a clearly-labeled venue.
  { slug: "init-capital-usde-mantle", name: "INIT Capital USDe (inUSDe)", protocol: "init-capital", category: "money-market", address: "0x3282437C436eE6AA9861a6A46ab0822d82581b1c" },

  // --- HyperEVM (999) ---
  // Most HyperEVM USDe is bridged into HyperCore via the system address; the
  // on-chain DeFi venues are small, so the sub-100k ones are kept as labeled
  // venues for coverage of this in-scope chain.
  { slug: "hypercore-usde-bridge-hyperevm", name: "HyperCore<>HyperEVM system bridge (USDe)", protocol: "hyperliquid", category: "bridge", address: "0x20000000000000000000000000000000000000eB" },
  { slug: "parallel-usdp-hyperevm", name: "Parallel Protocol USDp collateral (Parallelizer)", protocol: "parallel", category: "vault", address: "0x1250304F66404cd153fA39388DDCDAec7E0f1707" },
  { slug: "morpho-blue-hyperevm", name: "Morpho Blue (HyperEVM markets)", protocol: "morpho", category: "money-market", address: "0x68e37dE8d93d3496ae143F2E900490f6280C57cD" },
  { slug: "hyperlend-usde-hyperevm", name: "HyperLend USDe (hHyperEvmUSDe)", protocol: "hyperlend", category: "money-market", address: "0x333819c04975554260AaC119948562a0E24C2bd6" },
  { slug: "hypurrfi-usde-hyperevm", name: "HypurrFi USDe (hyUSDe)", protocol: "hypurrfi", category: "money-market", address: "0xe8F7D82A73f13A64d689e7ddAD06139BFb51f9C6" },

  // --- Arbitrum (42161) ---
  // Small chain (~1.8M USDe / ~1.9M sUSDe); the largest venue holders kept.
  { slug: "fluid-liquidity-arbitrum", name: "Fluid (Instadapp) Liquidity layer", protocol: "fluid", category: "money-market", address: "0x52Aa899454998Be5b000Ad077a46Bbe360F4e497" },
  { slug: "morpho-blue-arbitrum", name: "Morpho Blue (Arbitrum markets)", protocol: "morpho", category: "money-market", address: "0x6c247b1F6182318877311737BaC0844bAa518F5e" },
  { slug: "pendle-sy-usde-arbitrum", name: "Pendle SY-USDe (Arbitrum)", protocol: "pendle", category: "yield-tokenization", address: "0xb3C24D9dcCC2Ec5f778742389ffe448E295B84e0" },
  // Below threshold (~85k USDe) but kept as a clearly-labeled perps venue.
  { slug: "gmx-usde-arbitrum", name: "GMX v2 GM market (USDe collateral)", protocol: "gmx", category: "perps", address: "0x0Cf1fb4d1FF67A3D8Ca92c9d6643F8F9be8e03E5" },
];

// Yield venues are what the Opportunities page surfaces; bridge/cex/other are
// supply-attribution infrastructure that consumers usually filter out.
const YIELD_CATEGORIES: ReadonlySet<OpportunityCategory> = new Set([
  "money-market",
  "dex-pool",
  "yield-tokenization",
  "vault",
  "perps",
]);

export function isYieldCategory(category: OpportunityCategory): boolean {
  return YIELD_CATEGORIES.has(category);
}

// chainId → lowercased holder address → entry. Lowercased so lookups are
// case-insensitive regardless of the caller's address formatting.
//
// Fail-fast invariants (module load, i.e. indexer startup): a duplicate
// (chainId, address) would silently drop one entry's balances from its slug,
// and a slug reused with different metadata would leave the Opportunity row
// first-writer-wins wrong. Several addresses MAY share a slug when they are
// genuinely one venue — but then their metadata must match exactly.
const byChain = new Map<number, Map<string, RegistryEntry>>();
const bySlug = new Map<string, RegistryEntry>();
for (const entry of REGISTRY) {
  const prior = bySlug.get(entry.slug);
  if (prior) {
    if (
      prior.chainId !== entry.chainId ||
      prior.name !== entry.name ||
      prior.protocol !== entry.protocol ||
      prior.category !== entry.category
    ) {
      throw new Error(
        `registry: slug "${entry.slug}" reused with different metadata`,
      );
    }
  } else {
    bySlug.set(entry.slug, entry);
  }

  let m = byChain.get(entry.chainId);
  if (!m) {
    m = new Map();
    byChain.set(entry.chainId, m);
  }
  const key = entry.address.toLowerCase();
  if (m.has(key)) {
    throw new Error(
      `registry: duplicate (chainId, address): ${entry.chainId} ${entry.address}`,
    );
  }
  m.set(key, entry);
}

export function lookupOpportunity(
  address: string,
): RegistryEntry | undefined {
  return byChain.get(chainId)?.get(address.toLowerCase());
}
