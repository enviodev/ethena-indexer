# Ethena Indexer

Real-time, wei-exact [Envio HyperIndex](https://envio.dev) indexer for [Ethena](https://ethena.fi) across **6 chains** — Ethereum, Arbitrum, Base, BNB, Mantle, HyperEVM. Full history from genesis, replayed in ~10 minutes on HyperSync, served as GraphQL.

Three products in one indexer:

| | What it answers | Who it's for |
|---|---|---|
| **Desk tape** | Every USDe mint/redeem ever, with collateral breakdown and hourly net-flow buckets. Net issuance is the delta the trading desk hedges. | trading team |
| **Cooldown liability queue** | Every sUSDe unstake in flight — per-owner amount, maturity timestamp, claim status — plus the total pending amount and live 7d trailing sUSDe APR/APY. Forward redemption pressure, quantified. | trading team / risk |
| **Opportunities backend** | Per-holder USDe/sUSDe balances on every chain, per-chain supply, and live TVL per venue via a 57-entry on-chain-verified integration registry (Pendle, Aave, Morpho, Curve, Fluid, CEX custody, …), with hourly TVL history. | the Opportunities product |

## Why trust the numbers

Every aggregate is cross-checked against on-chain state after a full-history replay:

- USDe & sUSDe total supply match `totalSupply()` **to the wei** on **all 6 chains** (12/12 rows)
- Venue TVLs match `balanceOf()` exactly (e.g. the sUSDe vault's 1.64B USDe, Morpho Blue's 201M USDe on Base)
- `sum(ACTIVE cooldowns) == pendingCooldownAmount` exactly, across 37k+ cooldown events and 23k+ claims
- The silo's real USDe balance is tracked independently (`siloUsdeBalance`) as a standing reconciliation signal; unattributable claims land in an `UnmatchedSiloOutflow` audit table (empty across all of history)

## Quickstart

```bash
pnpm install
pnpm dev          # local Postgres + Hasura via Docker, then a full 6-chain sync (~10 min)
```

GraphQL playground: http://localhost:8080 (local password `testing`). `ENVIO_API_TOKEN` in `.env` (see `.env.example`) is used for HyperSync.

```bash
pnpm codegen      # regenerate types after config.yaml / schema.graphql changes
pnpm test         # vitest — simulate-based unit tests + live-block tests against real mainnet/L2 data
```

## Example queries

**What's the desk hedging this week?** — hourly net issuance:

```graphql
{
  HourlyFlow(order_by: {hourStartTimestamp: desc}, limit: 168) {
    hourStartTimestamp usdeMinted usdeRedeemed netFlow mintCount redeemCount
  }
}
```

**How much unstake pressure is coming, and when?**

```graphql
{
  StakingStats { pendingCooldownAmount apr7dPct apy7dPct }
  SusdeCooldown(where: {status: {_eq: "ACTIVE"}}, order_by: {underlyingAmount: desc}, limit: 20) {
    owner underlyingAmount cooldownEnd
  }
}
```

**Top yield venues by live TVL** (the Opportunities page, as an API — bridge lockboxes and CEX custody are indexed too but flagged out):

```graphql
{
  Opportunity(where: {isYieldVenue: {_eq: true}}, order_by: {usdeBalance: desc}, limit: 10) {
    id name protocol category chainId usdeBalance susdeBalance
  }
}
```

**sUSDe yield history since genesis:**

```graphql
{ DailyStakingYield(order_by: {dayStartTimestamp: desc}, limit: 90) { dayStartTimestamp rewardsReceived aprDayPct } }
```

**Any holder's balances, anywhere:**

```graphql
{ TokenBalance(where: {holder: {_eq: "0x..."}}) { chainId token balance opportunitySlug } }
```

## Indexed contracts

Ethereum mainnet:

| Contract | Address | Events |
|---|---|---|
| USDe | `0x4c9EDD5852cd905f086C759E8383e09bff1E68B3` | Transfer |
| sUSDe (StakedUSDeV2) | `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497` | Deposit, Withdraw, RewardsReceived, CooldownDurationUpdated, Transfer |
| EthenaMinting V1 | `0x2CC440b721d2CaFd6D64908D6d8C4aCC57F8Afc3` | Mint, Redeem, CustodyTransfer |
| EthenaMinting V2 | `0xe3490297a08d6fC8Da46Edb7B6142E4F461b62D3` | Mint, Redeem, CustodyTransfer |

L2s — Arbitrum (42161), Base (8453), BNB (56), Mantle (5000), HyperEVM (999) — via the LayerZero OFT deployments, same canonical addresses on every chain: USDe `0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34`, sUSDe `0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2` (Transfer). Chains were included only after verifying real supply on-chain; the omitted EVM chains (Optimism, Blast, Linea) hold negligible amounts.

## Entities

| Entity | What it holds |
|---|---|
| `MintRedeemEvent` | The tape: every mint/redeem with benefactor, collateral asset/amount, USDe amount |
| `HourlyFlow` / `HourlyStakingFlow` | Hourly issuance and staking flow buckets (same hour ids — joinable) |
| `ProtocolStats` | USDe supply (exact), cumulative mint/redeem totals and counts |
| `CollateralAssetStats` | Per-collateral cumulative mint/redeem volumes |
| `StakeAction` | Every DEPOSIT / COOLDOWN_STARTED / WITHDRAW / UNSTAKE_CLAIMED |
| `SusdeCooldown` | Per-owner cooldown slot: amount, maturity, ACTIVE/CLAIMED |
| `StakingStats` | Total staked, sUSDe supply, pending cooldown total, silo reconciliation balance, live 7d APR/APY |
| `DailyStakingYield` | Daily sUSDe rewards + annualized rate, full history |
| `RewardsPayment` | Every 8-hourly yield transfer into the vault |
| `TokenBalance` | Per-holder USDe/sUSDe balance per chain, stamped with the venue slug when classified |
| `Opportunity` | Live TVL per registry venue; `isYieldVenue` separates yield venues from bridge/CEX infrastructure |
| `OpportunityHourlySnapshot` | Hourly venue TVL series (sparse — rows only for active hours; forward-fill when charting) |
| `ChainSupply` | Per-chain circulating supply (see reconciliation note below) |
| `LargeTransfer` | Whale watch: transfers ≥ 1M USDe/sUSDe on any indexed chain |
| `CustodyEvent` | Collateral movements to/from custodians |
| `UnmatchedSiloOutflow` | Audit trail for unstake claims the matcher couldn't attribute (empty in normal operation) |

**Supply reconciliation:** don't sum `ChainSupply` across chains. Bridging *locks* tokens in the mainnet OFT adapter (a plain transfer) and *mints* on the destination chain, so a cross-chain sum double-counts. Mainnet is canonical; the adapters' `TokenBalance` rows reconcile the L2 supplies (Ethena bridges to more chains than are indexed here, so indexed L2 supply ≤ adapter balance).

## How unstake claims are detected

`unstake()` emits **no event** on sUSDe. When a cooldown matures, the silo (`0x7FC7c91D556B400AFa565013E3F32055a0713425`) transfers the claimed USDe out — so the USDe `Transfer` handler detects silo outflows and matches them to cooldowns by exact amount + transaction sender (the cooldown is keyed by `unstake()`'s caller), falling back to the receiver, then to the sole candidate. Zero-value outflows (calls on an empty cooldown slot — common) are ignored. Anything unattributable is recorded in `UnmatchedSiloOutflow` rather than guessed at. Across full mainnet history the matcher attributed every claim.

## Registry

`src/handlers/registry.ts` maps 57 holder contracts to venues across the 6 chains — every entry admitted only after an on-chain `balanceOf` check. Coverage of circulating supply at time of build: Ethereum 96.8% (USDe), Base 99.8%, BNB 99.7%, Mantle 98.2% (sUSDe), HyperEVM ~90%. Adding a venue is a one-line registry entry + redeploy (history replays in minutes); invariants (unique address per chain, consistent slug metadata) are asserted at startup.

## Project layout

```
config.yaml               # chains + contracts + events
schema.graphql            # entities
src/handlers/
  minting.ts              # EthenaMinting V1/V2 → the tape
  usde.ts                 # USDe transfers → supply, whales, silo detection, balances
  staking.ts              # sUSDe → cooldown queue, yield series, claim matcher
  oft.ts                  # L2 OFT transfers → balances + whales
  balances.ts             # multichain balance/TVL engine
  registry.ts             # the 57-venue integration registry
  common.ts               # shared constants + helpers
src/*.test.ts             # 46 tests (unit + live-block)
```

## Pre-requisites

- [Node.js v22+](https://nodejs.org/en/download/current)
- [pnpm v8+](https://pnpm.io/installation)
- [Docker](https://www.docker.com/products/docker-desktop/) or [Podman](https://podman.io/)
