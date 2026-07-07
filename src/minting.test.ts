import { describe, it } from "vitest";
import { createTestIndexer, TestHelpers } from "envio";

const { mockAddresses } = TestHelpers.Addresses;

// Distinct, valid checksummed actors for the simulate tests.
const BENEFACTOR = mockAddresses[0]!;
const BENEFICIARY = mockAddresses[1]!;
const EXECUTOR = mockAddresses[2]!;
const COLLATERAL = mockAddresses[3]!;
const HOLDER = mockAddresses[4]!;
const COUNTERPARTY = mockAddresses[5]!;

const ZERO = "0x0000000000000000000000000000000000000000";
// V2 order_id is an indexed string → its decoded value is the keccak topic hash.
const ORDER_ID = "0x" + "ab".repeat(32);
const TX_HASH = "0x" + "cd".repeat(32);

const E18 = 10n ** 18n;
const E6 = 10n ** 6n;
const LARGE_THRESHOLD = 1_000_000n * E18;

const hourStartOf = (ts: number) => Math.floor(ts / 3600) * 3600;

// ── Simulate-based unit tests (deterministic, no network) ──────────────────

describe("minting/usde handlers (simulate)", () => {
  it("V2 Mint creates a MintRedeemEvent and rolls up protocol/hourly/collateral stats", async (t) => {
    const indexer = createTestIndexer();
    const blockNumber = 21_000_000;
    const timestamp = 1_700_000_000;
    const usdeAmount = 1_000n * E18;
    const collateralAmount = 1_000n * E6;

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "EthenaMintingV2",
              event: "Mint",
              params: {
                order_id: ORDER_ID,
                benefactor: BENEFACTOR,
                beneficiary: BENEFICIARY,
                minter: EXECUTOR,
                collateral_asset: COLLATERAL,
                collateral_amount: collateralAmount,
                usde_amount: usdeAmount,
              },
              block: { number: blockNumber, timestamp },
              transaction: { hash: TX_HASH, from: EXECUTOR },
              logIndex: 0,
            },
          ],
        },
      },
    });

    const id = `1_${blockNumber}_0`;
    t.expect(await indexer.MintRedeemEvent.getOrThrow(id)).toEqual({
      id,
      flowType: "MINT",
      version: "V2",
      orderId: ORDER_ID,
      benefactor: BENEFACTOR,
      beneficiary: BENEFICIARY,
      executor: EXECUTOR,
      collateralAsset: COLLATERAL,
      collateralAmount,
      usdeAmount,
      blockNumber: BigInt(blockNumber),
      timestamp: BigInt(timestamp),
      txHash: TX_HASH,
    });

    t.expect(await indexer.ProtocolStats.getOrThrow("global")).toEqual({
      id: "global",
      usdeTotalSupply: 0n,
      cumulativeUsdeMinted: usdeAmount,
      cumulativeUsdeRedeemed: 0n,
      mintCount: 1,
      redeemCount: 0,
      lastUpdatedTimestamp: BigInt(timestamp),
    });

    const hourStart = hourStartOf(timestamp);
    t.expect(await indexer.HourlyFlow.getOrThrow(String(hourStart))).toEqual({
      id: String(hourStart),
      hourStartTimestamp: BigInt(hourStart),
      usdeMinted: usdeAmount,
      usdeRedeemed: 0n,
      netFlow: usdeAmount,
      mintCount: 1,
      redeemCount: 0,
    });

    t.expect(await indexer.CollateralAssetStats.getOrThrow(COLLATERAL)).toEqual({
      id: COLLATERAL,
      usdeMinted: usdeAmount,
      usdeRedeemed: 0n,
      collateralDeposited: collateralAmount,
      collateralWithdrawn: 0n,
      mintCount: 1,
      redeemCount: 0,
      lastUpdatedTimestamp: BigInt(timestamp),
    });
  });

  it("V1 Redeem creates a MintRedeemEvent and rolls up redeem-side stats", async (t) => {
    const indexer = createTestIndexer();
    const blockNumber = 18_500_000;
    const timestamp = 1_699_990_000;
    const usdeAmount = 250n * E18;
    const collateralAmount = 250n * E6;

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "EthenaMintingV1",
              event: "Redeem",
              params: {
                redeemer: EXECUTOR,
                benefactor: BENEFACTOR,
                beneficiary: BENEFICIARY,
                collateral_asset: COLLATERAL,
                collateral_amount: collateralAmount,
                usde_amount: usdeAmount,
              },
              block: { number: blockNumber, timestamp },
              transaction: { hash: TX_HASH, from: EXECUTOR },
              logIndex: 3,
            },
          ],
        },
      },
    });

    const id = `1_${blockNumber}_3`;
    t.expect(await indexer.MintRedeemEvent.getOrThrow(id)).toEqual({
      id,
      flowType: "REDEEM",
      version: "V1",
      orderId: undefined,
      benefactor: BENEFACTOR,
      beneficiary: BENEFICIARY,
      executor: EXECUTOR,
      collateralAsset: COLLATERAL,
      collateralAmount,
      usdeAmount,
      blockNumber: BigInt(blockNumber),
      timestamp: BigInt(timestamp),
      txHash: TX_HASH,
    });

    t.expect(await indexer.ProtocolStats.getOrThrow("global")).toEqual({
      id: "global",
      usdeTotalSupply: 0n,
      cumulativeUsdeMinted: 0n,
      cumulativeUsdeRedeemed: usdeAmount,
      mintCount: 0,
      redeemCount: 1,
      lastUpdatedTimestamp: BigInt(timestamp),
    });

    const hourStart = hourStartOf(timestamp);
    t.expect(await indexer.HourlyFlow.getOrThrow(String(hourStart))).toEqual({
      id: String(hourStart),
      hourStartTimestamp: BigInt(hourStart),
      usdeMinted: 0n,
      usdeRedeemed: usdeAmount,
      netFlow: -usdeAmount,
      mintCount: 0,
      redeemCount: 1,
    });

    t.expect(await indexer.CollateralAssetStats.getOrThrow(COLLATERAL)).toEqual({
      id: COLLATERAL,
      usdeMinted: 0n,
      usdeRedeemed: usdeAmount,
      collateralDeposited: 0n,
      collateralWithdrawn: collateralAmount,
      mintCount: 0,
      redeemCount: 1,
      lastUpdatedTimestamp: BigInt(timestamp),
    });
  });

  it("USDe mint from the zero address grows total supply; burn to zero shrinks it", async (t) => {
    const indexer = createTestIndexer();
    const mintValue = 500n * E18;
    const burnValue = 200n * E18;

    // Mint: from == 0x0
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "USDe",
              event: "Transfer",
              params: { from: ZERO, to: HOLDER, value: mintValue },
              block: { number: 20_000_000, timestamp: 1_700_000_000 },
              transaction: { hash: TX_HASH, from: HOLDER },
              logIndex: 0,
            },
          ],
        },
      },
    });

    t.expect((await indexer.ProtocolStats.getOrThrow("global")).usdeTotalSupply).toEqual(
      mintValue,
    );

    // Burn: to == 0x0
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "USDe",
              event: "Transfer",
              params: { from: HOLDER, to: ZERO, value: burnValue },
              block: { number: 20_000_001, timestamp: 1_700_000_050 },
              transaction: { hash: TX_HASH, from: HOLDER },
              logIndex: 0,
            },
          ],
        },
      },
    });

    t.expect((await indexer.ProtocolStats.getOrThrow("global")).usdeTotalSupply).toEqual(
      mintValue - burnValue,
    );

    // Neither is a "large" transfer, so nothing on the whale watchlist.
    t.expect(await indexer.LargeTransfer.getAll()).toHaveLength(0);
  });

  it("USDe transfer at/above 1M USDe records a LargeTransfer (token USDe)", async (t) => {
    const indexer = createTestIndexer();
    const blockNumber = 20_100_000;
    const timestamp = 1_700_100_000;

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "USDe",
              event: "Transfer",
              params: { from: HOLDER, to: COUNTERPARTY, value: LARGE_THRESHOLD },
              block: { number: blockNumber, timestamp },
              transaction: { hash: TX_HASH, from: HOLDER },
              logIndex: 7,
            },
          ],
        },
      },
    });

    const id = `1_${blockNumber}_7`;
    t.expect(await indexer.LargeTransfer.getOrThrow(id)).toEqual({
      id,
      chainId: 1,
      token: "USDe",
      from: HOLDER,
      to: COUNTERPARTY,
      amount: LARGE_THRESHOLD,
      txFrom: HOLDER,
      blockNumber: BigInt(blockNumber),
      timestamp: BigInt(timestamp),
      txHash: TX_HASH,
    });

    // Non-zero from/to → supply untouched (no ProtocolStats row created).
    t.expect(await indexer.ProtocolStats.get("global")).toBeUndefined();
  });

  it("USDe transfer just below the threshold (non-zero parties) writes nothing", async (t) => {
    const indexer = createTestIndexer();
    const blockNumber = 20_200_000;

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "USDe",
              event: "Transfer",
              params: { from: HOLDER, to: COUNTERPARTY, value: LARGE_THRESHOLD - 1n },
              block: { number: blockNumber, timestamp: 1_700_200_000 },
              transaction: { hash: TX_HASH, from: HOLDER },
              logIndex: 0,
            },
          ],
        },
      },
    });

    t.expect(await indexer.LargeTransfer.getAll()).toHaveLength(0);
    t.expect(await indexer.ProtocolStats.get("global")).toBeUndefined();
  });
});

// ── One live-block snapshot test (real HyperSync data) ─────────────────────
// A real EthenaMintingV2 Redeem mined on Ethereum mainnet at block 25,479,617
// (log index 97). Discovered/decoded via HyperSync + viem. Processing the full
// block also routes other contracts' events to the staking half's handlers —
// we assert ONLY on the MintRedeemEvent this half owns.

describe("minting handlers (live block)", () => {
  it("indexes the real EthenaMintingV2 Redeem at block 25479617", async (t) => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: { 1: { startBlock: 25_479_617, endBlock: 25_479_617 } },
    });

    t.expect(await indexer.MintRedeemEvent.getOrThrow("1_25479617_97")).toEqual({
      id: "1_25479617_97",
      flowType: "REDEEM",
      version: "V2",
      orderId: "0xa2678134968d089aedbcb274648cb6ab3205b320d5c32df8b61af33a98c1733e",
      benefactor: "0x8D3e0EbEd830D3cC2C68DB54E7D838D081ADA8Bc",
      beneficiary: "0x8D3e0EbEd830D3cC2C68DB54E7D838D081ADA8Bc",
      executor: "0x661Ca83074b8Ec630825D4604455325499F951a1",
      collateralAsset: "0xC139190F447e929f090Edeb554D95AbB8b18aC1C",
      collateralAmount: 199758278000000000000000n,
      usdeAmount: 199879000000000000000000n,
      blockNumber: 25_479_617n,
      timestamp: 1_783_414_631n,
      txHash: "0xa8f1a60919e4d22641956d3ace99321f5575d2561eb861e31784dccf8c692f1f",
    });
  });
});
