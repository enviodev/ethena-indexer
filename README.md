# Ethena Indexer

Real-time [Envio HyperIndex](https://envio.dev) indexer for [Ethena](https://ethena.fi) on Ethereum mainnet, built for two trading-desk use cases:

1. **Mint/redeem flow ("the tape")** — every USDe issuance event with collateral breakdown, hourly net-flow buckets, and cumulative per-collateral stats. Net issuance is the delta the desk hedges.
2. **sUSDe cooldown liability queue** — every stake/unstake, the per-owner cooldown state machine (amount, maturity, claimed), and the total pending unstake amount: known future redemption pressure.

## Indexed contracts (Ethereum mainnet)

| Contract | Address | Events |
|---|---|---|
| USDe | `0x4c9EDD5852cd905f086C759E8383e09bff1E68B3` | Transfer |
| sUSDe (StakedUSDeV2) | `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497` | Deposit, Withdraw, RewardsReceived, CooldownDurationUpdated, Transfer |
| EthenaMinting V1 | `0x2CC440b721d2CaFd6D64908D6d8C4aCC57F8Afc3` | Mint, Redeem, CustodyTransfer |
| EthenaMinting V2 | `0xe3490297a08d6fC8Da46Edb7B6142E4F461b62D3` | Mint, Redeem, CustodyTransfer |

## Main queryable entities

- `MintRedeemEvent` — the tape: every mint/redeem with benefactor, collateral asset/amount, USDe amount
- `HourlyFlow` / `HourlyStakingFlow` — hourly issuance and staking flow buckets (same hour-bucket ids, joinable)
- `ProtocolStats` — USDe total supply (exact, from transfer accounting), cumulative mint/redeem totals
- `CollateralAssetStats` — per-collateral cumulative mint/redeem volumes
- `StakeAction` — every DEPOSIT / COOLDOWN_STARTED / WITHDRAW / UNSTAKE_CLAIMED
- `SusdeCooldown` — per-owner cooldown slot: amount, maturity (`cooldownEnd`), ACTIVE/CLAIMED
- `StakingStats` — total staked, sUSDe supply, `pendingCooldownAmount` (the liability queue), `siloUsdeBalance` (ground-truth reconciliation)
- `LargeTransfer` — USDe/sUSDe transfers ≥ 1M (whale watch)
- `UnmatchedSiloOutflow` — audit trail for unstake claims the matcher couldn't attribute (empty in normal operation)

Unstake claims emit no sUSDe event; they are detected from USDe transfers out of the cooldown silo (`0x7FC7c91D556B400AFa565013E3F32055a0713425`) and matched to cooldowns by amount + tx sender/receiver. See `src/handlers/staking.ts`.

## Run

```bash
pnpm install
pnpm dev          # local Postgres/Hasura via Docker + full mainnet sync (~minutes on HyperSync)
```

GraphQL playground: http://localhost:8080 (local password `testing`). `ENVIO_API_TOKEN` in `.env` is used for HyperSync; tests also run without it.

```bash
pnpm codegen      # regenerate types after config.yaml / schema.graphql changes
pnpm test         # vitest — simulate-based unit tests + live-block tests
```

### Pre-requisites

- [Node.js v22+](https://nodejs.org/en/download/current)
- [pnpm v8+](https://pnpm.io/installation)
- [Docker](https://www.docker.com/products/docker-desktop/) or [Podman](https://podman.io/)
