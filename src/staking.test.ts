import { describe, it } from "vitest";
import { createTestIndexer, TestHelpers } from "envio";
import { USDE_SILO } from "./handlers/staking";

const { Addresses } = TestHelpers;

type Hex = `0x${string}`;

// Distinct, valid checksummed test addresses.
const OWNER = Addresses.mockAddresses[0]! as Hex;
const OWNER2 = Addresses.mockAddresses[1]! as Hex;
const RECEIVER = Addresses.mockAddresses[2]! as Hex;
const RELAYER = Addresses.mockAddresses[3]! as Hex;
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;
// Literal (not imported) so a bad edit to the handler constant fails here
// instead of making every simulate test pass tautologically.
const SILO = "0x7FC7c91D556B400AFa565013E3F32055a0713425" as Hex;

const TX = ("0x" + "ab".repeat(32)) as Hex;

// A fixed base timestamp and its hour bucket (floor to 3600s).
const TS = 1_700_000_000;
const HOUR = Math.floor(TS / 3600) * 3600;
const HOUR_ID = String(HOUR);

// Cooldown duration the StakedUSDeV2 constructor sets at deployment: 90 days.
// (Constructor assigns cooldownDuration = MAX_COOLDOWN_DURATION silently — no
// event — so StakingStats must seed this value.)
const DEFAULT_DURATION = 7_776_000n; // 90 * 24 * 60 * 60

const usde = (whole: bigint) => whole * 10n ** 18n;

// Helpers to keep simulate items terse.
function deposit(
  indexer: ReturnType<typeof createTestIndexer>,
  opts: {
    owner: Hex;
    sender?: Hex;
    assets: bigint;
    shares?: bigint;
    block: number;
    logIndex: number;
    timestamp?: number;
  },
) {
  return indexer.process({
    chains: {
      1: {
        simulate: [
          {
            contract: "StakedUSDe",
            event: "Deposit",
            logIndex: opts.logIndex,
            block: { number: opts.block, timestamp: opts.timestamp ?? TS },
            transaction: { hash: TX, from: opts.sender ?? opts.owner },
            params: {
              sender: opts.sender ?? opts.owner,
              owner: opts.owner,
              assets: opts.assets,
              shares: opts.shares ?? opts.assets,
            },
          },
        ],
      },
    },
  });
}

function withdraw(
  indexer: ReturnType<typeof createTestIndexer>,
  opts: {
    owner: Hex;
    sender?: Hex;
    receiver: Hex;
    assets: bigint;
    shares?: bigint;
    block: number;
    logIndex: number;
    timestamp?: number;
  },
) {
  return indexer.process({
    chains: {
      1: {
        simulate: [
          {
            contract: "StakedUSDe",
            event: "Withdraw",
            logIndex: opts.logIndex,
            block: { number: opts.block, timestamp: opts.timestamp ?? TS },
            transaction: { hash: TX, from: opts.sender ?? opts.owner },
            params: {
              sender: opts.sender ?? opts.owner,
              receiver: opts.receiver,
              owner: opts.owner,
              assets: opts.assets,
              shares: opts.shares ?? opts.assets,
            },
          },
        ],
      },
    },
  });
}

// A USDe Transfer FROM the silo — routed by the other half's usde.ts handler
// into handleSiloOutflow (the unstake-claim detector).
function siloOutflow(
  indexer: ReturnType<typeof createTestIndexer>,
  opts: {
    to: Hex;
    from?: Hex; // tx sender
    value: bigint;
    block: number;
    logIndex: number;
    timestamp?: number;
  },
) {
  return indexer.process({
    chains: {
      1: {
        simulate: [
          {
            contract: "USDe",
            event: "Transfer",
            logIndex: opts.logIndex,
            block: { number: opts.block, timestamp: opts.timestamp ?? TS },
            transaction: { hash: TX, from: opts.from ?? opts.to },
            params: { from: SILO, to: opts.to, value: opts.value },
          },
        ],
      },
    },
  });
}

describe("sUSDe staking handlers", () => {
  it("handler USDE_SILO constant matches the on-chain StakedUSDeV2.silo() address", (t) => {
    t.expect(USDE_SILO).toBe(SILO);
  });

  it("Deposit: updates StakingStats + HourlyStakingFlow and records a DEPOSIT StakeAction", async (t) => {
    const indexer = createTestIndexer();
    await deposit(indexer, { owner: OWNER, assets: 1000n, shares: 900n, block: 100, logIndex: 5 });

    const stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.totalStakedUsde).toBe(1000n);
    t.expect(stats.depositCount).toBe(1);
    // Seeded from the constructor value (90 days) since no CooldownDurationUpdated
    // is emitted at deployment.
    t.expect(stats.cooldownDurationSeconds).toBe(DEFAULT_DURATION);

    const hourly = await indexer.HourlyStakingFlow.getOrThrow(HOUR_ID);
    t.expect(hourly.usdeStaked).toBe(1000n);
    t.expect(hourly.netFlow).toBe(1000n);

    const action = await indexer.StakeAction.getOrThrow("1_100_5");
    t.expect(action.actionType).toBe("DEPOSIT");
    t.expect(action.account).toBe(OWNER);
    t.expect(action.caller).toBe(OWNER);
    t.expect(action.assets).toBe(1000n);
    t.expect(action.shares).toBe(900n);
  });

  it("Withdraw to silo: starts an ACTIVE cooldown and moves totalStaked → pending", async (t) => {
    const indexer = createTestIndexer();
    await deposit(indexer, { owner: OWNER, assets: 5000n, block: 100, logIndex: 0 });
    await withdraw(indexer, {
      owner: OWNER,
      receiver: SILO,
      assets: 2000n,
      shares: 1800n,
      block: 200,
      logIndex: 1,
    });

    const cd = await indexer.SusdeCooldown.getOrThrow(OWNER);
    t.expect(cd.status).toBe("ACTIVE");
    t.expect(cd.underlyingAmount).toBe(2000n);
    t.expect(cd.startedAt).toBe(BigInt(TS));
    t.expect(cd.cooldownEnd).toBe(BigInt(TS) + DEFAULT_DURATION);
    t.expect(cd.claimedAt).toBeUndefined();

    const stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.totalStakedUsde).toBe(3000n); // 5000 deposited - 2000 cooled down
    t.expect(stats.pendingCooldownAmount).toBe(2000n);
    t.expect(stats.cooldownCount).toBe(1);

    const hourly = await indexer.HourlyStakingFlow.getOrThrow(HOUR_ID);
    t.expect(hourly.usdeCooldownStarted).toBe(2000n);
    t.expect(hourly.netFlow).toBe(3000n); // +5000 deposit - 2000 cooldown

    const action = await indexer.StakeAction.getOrThrow("1_200_1");
    t.expect(action.actionType).toBe("COOLDOWN_STARTED");
    t.expect(action.account).toBe(OWNER);
    t.expect(action.receiver).toBe(USDE_SILO);
  });

  it("Second cooldown by same owner accumulates amount and resets cooldownEnd (keeps startedAt)", async (t) => {
    const indexer = createTestIndexer();
    const TS2 = TS + 100;
    await withdraw(indexer, {
      owner: OWNER,
      receiver: SILO,
      assets: 1000n,
      block: 10,
      logIndex: 0,
      timestamp: TS,
    });
    await withdraw(indexer, {
      owner: OWNER,
      receiver: SILO,
      assets: 500n,
      block: 11,
      logIndex: 0,
      timestamp: TS2,
    });

    const cd = await indexer.SusdeCooldown.getOrThrow(OWNER);
    t.expect(cd.underlyingAmount).toBe(1500n); // accumulated
    t.expect(cd.startedAt).toBe(BigInt(TS)); // preserved from first add
    t.expect(cd.cooldownEnd).toBe(BigInt(TS2) + DEFAULT_DURATION); // reset to latest
    t.expect(cd.status).toBe("ACTIVE");

    const stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.pendingCooldownAmount).toBe(1500n);
    t.expect(stats.cooldownCount).toBe(2);
  });

  it("RewardsReceived: builds the daily yield series and the 7d trailing APR/APY", async (t) => {
    const indexer = createTestIndexer();
    const DAY = 86_400;
    // Anchor to a UTC day boundary so both events land in one day bucket.
    const day0 = Math.floor(TS / DAY) * DAY;
    const staked = usde(1_000_000n);

    await deposit(indexer, { owner: OWNER, assets: staked, block: 100, logIndex: 0, timestamp: day0 });

    // Two reward payments of 500 USDe on the same day, on 1M staked (+rewards).
    for (const [i, ts] of [day0 + 3600, day0 + 7200].entries()) {
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "StakedUSDe",
                event: "RewardsReceived",
                logIndex: 0,
                block: { number: 101 + i, timestamp: ts },
                transaction: { hash: TX, from: OWNER },
                params: { amount: usde(500n) },
              },
            ],
          },
        },
      });
    }

    const daily = await indexer.DailyStakingYield.getOrThrow(String(day0));
    t.expect(daily.rewardsReceived).toBe(usde(1000n));
    t.expect(daily.rewardEvents).toBe(2);
    t.expect(daily.totalStakedAtEnd).toBe(usde(1_001_000n));
    // 1000/1,001,000 annualized: ~36.46%/yr for a single 0.1%/day reading.
    t.expect(daily.aprDayPct).toBeCloseTo((1000 / 1_001_000) * 365 * 100, 6);

    const stats = await indexer.StakingStats.getOrThrow("global");
    // Only one day of the 7d window has rewards → weekly rate = 1000/1,001,000.
    const weekly = 1000 / 1_001_000;
    t.expect(stats.apr7dPct).toBeCloseTo(weekly * (365 / 7) * 100, 6);
    t.expect(stats.apy7dPct).toBeCloseTo((Math.pow(1 + weekly, 365 / 7) - 1) * 100, 6);
    // Compounded APY must exceed simple APR.
    t.expect(stats.apy7dPct).toBeGreaterThan(stats.apr7dPct);
  });

  it("RewardsReceived: accrues to vault + cumulativeRewards, NOT into netFlow", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "StakedUSDe",
              event: "RewardsReceived",
              logIndex: 3,
              block: { number: 100, timestamp: TS },
              transaction: { hash: TX, from: OWNER },
              params: { amount: 300n },
            },
          ],
        },
      },
    });

    const stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.cumulativeRewards).toBe(300n);
    t.expect(stats.totalStakedUsde).toBe(300n); // yield accrues to the vault

    const hourly = await indexer.HourlyStakingFlow.getOrThrow(HOUR_ID);
    t.expect(hourly.rewardsReceived).toBe(300n);
    t.expect(hourly.netFlow).toBe(0n); // rewards excluded from user-flow netFlow

    const payment = await indexer.RewardsPayment.getOrThrow("1_100_3");
    t.expect(payment.amount).toBe(300n);
  });

  it("CooldownDurationUpdated: updates cooldownDurationSeconds and later cooldowns use it", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "StakedUSDe",
              event: "CooldownDurationUpdated",
              logIndex: 0,
              block: { number: 50, timestamp: TS },
              transaction: { hash: TX, from: OWNER },
              params: { previousDuration: DEFAULT_DURATION, newDuration: 86_400n },
            },
          ],
        },
      },
    });

    let stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.cooldownDurationSeconds).toBe(86_400n);

    // A cooldown started afterwards uses the new 1-day window.
    const TS2 = TS + 3600;
    await withdraw(indexer, {
      owner: OWNER,
      receiver: SILO,
      assets: 100n,
      block: 60,
      logIndex: 0,
      timestamp: TS2,
    });
    const cd = await indexer.SusdeCooldown.getOrThrow(OWNER);
    t.expect(cd.cooldownEnd).toBe(BigInt(TS2) + 86_400n);
  });

  it("sUSDe Transfer: mint (from 0x0) increases supply, burn (to 0x0) decreases it", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "StakedUSDe",
              event: "Transfer",
              logIndex: 0,
              block: { number: 100, timestamp: TS },
              transaction: { hash: TX, from: OWNER },
              params: { from: ZERO, to: OWNER, value: 1000n }, // mint
            },
            {
              contract: "StakedUSDe",
              event: "Transfer",
              logIndex: 1,
              block: { number: 100, timestamp: TS },
              transaction: { hash: TX, from: OWNER },
              params: { from: OWNER, to: ZERO, value: 400n }, // burn
            },
          ],
        },
      },
    });

    const stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.susdeTotalSupply).toBe(600n); // 1000 minted - 400 burned
  });

  it("sUSDe Transfer >= 1M creates a LargeTransfer(token: sUSDe); below-threshold does not", async (t) => {
    const indexer = createTestIndexer();
    const big = usde(2_000_000n);
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "StakedUSDe",
              event: "Transfer",
              logIndex: 2,
              block: { number: 300, timestamp: TS },
              transaction: { hash: TX, from: OWNER2 },
              params: { from: OWNER, to: OWNER2, value: big },
            },
            {
              contract: "StakedUSDe",
              event: "Transfer",
              logIndex: 3,
              block: { number: 300, timestamp: TS },
              transaction: { hash: TX, from: OWNER },
              params: { from: OWNER, to: OWNER2, value: usde(5n) }, // small
            },
          ],
        },
      },
    });

    const lt = await indexer.LargeTransfer.getOrThrow("1_300_2");
    t.expect(lt.token).toBe("sUSDe");
    t.expect(lt.amount).toBe(big);
    t.expect(lt.from).toBe(OWNER);
    t.expect(lt.to).toBe(OWNER2);
    t.expect(lt.txFrom).toBe(OWNER2);

    // The small transfer created no LargeTransfer row.
    const all = await indexer.LargeTransfer.getAll();
    t.expect(all).toHaveLength(1);
  });

  it("Claim path: USDe silo outflow closes the matching cooldown (UNSTAKE_CLAIMED)", async (t) => {
    const indexer = createTestIndexer();
    const amount = usde(1000n); // below the large-transfer threshold
    const TS2 = TS + 100;

    // 1) owner starts a cooldown that parks `amount` in the silo.
    await withdraw(indexer, {
      owner: OWNER,
      receiver: SILO,
      assets: amount,
      block: 400,
      logIndex: 0,
      timestamp: TS,
    });

    // 2) after maturity, unstake() makes the silo send USDe to the owner.
    await siloOutflow(indexer, {
      to: OWNER,
      from: OWNER,
      value: amount,
      block: 401,
      logIndex: 7,
      timestamp: TS2,
    });

    const cd = await indexer.SusdeCooldown.getOrThrow(OWNER);
    t.expect(cd.status).toBe("CLAIMED");
    t.expect(cd.claimedAt).toBe(BigInt(TS2));

    const stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.pendingCooldownAmount).toBe(0n); // liability retired

    const action = await indexer.StakeAction.getOrThrow("1_401_7");
    t.expect(action.actionType).toBe("UNSTAKE_CLAIMED");
    t.expect(action.account).toBe(OWNER);
    t.expect(action.receiver).toBe(OWNER);
    t.expect(action.assets).toBe(amount);
    t.expect(action.shares).toBeUndefined();

    const hourly = await indexer.HourlyStakingFlow.getOrThrow(HOUR_ID);
    t.expect(hourly.usdeUnstaked).toBe(amount);
    // netFlow was decremented at cooldown start; the claim must NOT touch it.
    t.expect(hourly.netFlow).toBe(-amount);
  });

  it("Direct Withdraw (receiver != silo): reduces totalStaked, records WITHDRAW", async (t) => {
    const indexer = createTestIndexer();
    await deposit(indexer, { owner: OWNER, assets: 5000n, block: 100, logIndex: 0 });
    await withdraw(indexer, {
      owner: OWNER,
      receiver: RECEIVER,
      assets: 1500n,
      block: 101,
      logIndex: 0,
    });

    const stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.totalStakedUsde).toBe(3500n);
    t.expect(stats.pendingCooldownAmount).toBe(0n); // no cooldown involved

    // No cooldown entity was created for a direct exit.
    t.expect(await indexer.SusdeCooldown.get(OWNER)).toBeUndefined();

    const action = await indexer.StakeAction.getOrThrow("1_101_0");
    t.expect(action.actionType).toBe("WITHDRAW");
    t.expect(action.receiver).toBe(RECEIVER);

    const hourly = await indexer.HourlyStakingFlow.getOrThrow(HOUR_ID);
    t.expect(hourly.usdeUnstaked).toBe(1500n);
    t.expect(hourly.netFlow).toBe(3500n); // +5000 deposit - 1500 withdraw
  });

  it("Silo outflow with no matching ACTIVE cooldown records an UnmatchedSiloOutflow (never throws)", async (t) => {
    const indexer = createTestIndexer();
    // No cooldown exists; the silo outflow can't be matched → audit row + return.
    await siloOutflow(indexer, {
      to: OWNER,
      value: 999n,
      block: 500,
      logIndex: 0,
    });

    const claims = (await indexer.StakeAction.getAll()).filter(
      (a) => a.actionType === "UNSTAKE_CLAIMED",
    );
    t.expect(claims).toHaveLength(0);

    const unmatched = await indexer.UnmatchedSiloOutflow.getOrThrow("1_500_0");
    t.expect(unmatched.amount).toBe(999n);
    t.expect(unmatched.to).toBe(OWNER);
    t.expect(unmatched.activeCandidates).toBe(0);

    // Balance accounting stays exact even when attribution fails.
    const stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.siloUsdeBalance).toBe(-999n); // no inflow was simulated
  });

  it("Claim matching prefers txFrom (the unstake caller/owner) over the receiver", async (t) => {
    const indexer = createTestIndexer();
    const amount = usde(1000n);
    // OWNER and OWNER2 both hold ACTIVE cooldowns of the same amount.
    await withdraw(indexer, { owner: OWNER, receiver: SILO, assets: amount, block: 600, logIndex: 0 });
    await withdraw(indexer, { owner: OWNER2, receiver: SILO, assets: amount, block: 601, logIndex: 0 });

    // OWNER unstakes with receiver = OWNER2. Receiver-first matching would
    // wrongly claim OWNER2's cooldown; the owner is the tx sender.
    await siloOutflow(indexer, {
      to: OWNER2,
      from: OWNER,
      value: amount,
      block: 602,
      logIndex: 4,
      timestamp: TS + 500,
    });

    t.expect((await indexer.SusdeCooldown.getOrThrow(OWNER)).status).toBe("CLAIMED");
    t.expect((await indexer.SusdeCooldown.getOrThrow(OWNER2)).status).toBe("ACTIVE");
    const stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.pendingCooldownAmount).toBe(amount); // only OWNER's retired
  });

  it("Ambiguous claim (equal amounts, unknown receiver+sender) records UnmatchedSiloOutflow and leaves cooldowns intact", async (t) => {
    const indexer = createTestIndexer();
    const amount = usde(500n);
    await withdraw(indexer, { owner: OWNER, receiver: SILO, assets: amount, block: 700, logIndex: 0 });
    await withdraw(indexer, { owner: OWNER2, receiver: SILO, assets: amount, block: 701, logIndex: 0 });
    // The vault's matching USDe transfers into the silo (emitted in the same
    // txs on mainnet; simulated separately here).
    for (const block of [703, 704]) {
      await indexer.process({
        chains: {
          1: {
            simulate: [
              {
                contract: "USDe",
                event: "Transfer",
                logIndex: 1,
                block: { number: block, timestamp: TS },
                transaction: { hash: TX, from: OWNER },
                params: { from: OWNER2, to: SILO, value: amount },
              },
            ],
          },
        },
      });
    }

    // Outflow to a fresh receiver, sent by an unrelated relayer: 2 candidates,
    // none identifiable → audit row, no guess.
    await siloOutflow(indexer, {
      to: RECEIVER,
      from: RELAYER,
      value: amount,
      block: 705,
      logIndex: 9,
      timestamp: TS + 600,
    });

    t.expect((await indexer.SusdeCooldown.getOrThrow(OWNER)).status).toBe("ACTIVE");
    t.expect((await indexer.SusdeCooldown.getOrThrow(OWNER2)).status).toBe("ACTIVE");

    const unmatched = await indexer.UnmatchedSiloOutflow.getOrThrow("1_705_9");
    t.expect(unmatched.activeCandidates).toBe(2);

    const stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.pendingCooldownAmount).toBe(amount * 2n); // untouched
    // ...but the ground-truth balance still reflects the outflow, so the
    // drift is visible as siloUsdeBalance < pendingCooldownAmount.
    t.expect(stats.siloUsdeBalance).toBe(amount * 2n - amount);
  });

  it("Silo balance: inflows (cooldown parks) and outflows (claims) reconcile to zero", async (t) => {
    const indexer = createTestIndexer();
    const amount = usde(250n);

    // Cooldown start: sUSDe Withdraw + the vault's USDe transfer INTO the silo
    // (distinct block — the test indexer skips a block it already processed).
    await withdraw(indexer, { owner: OWNER, receiver: SILO, assets: amount, block: 800, logIndex: 0 });
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "USDe",
              event: "Transfer",
              logIndex: 1,
              block: { number: 801, timestamp: TS },
              transaction: { hash: TX, from: OWNER },
              params: { from: OWNER2, to: SILO, value: amount },
            },
          ],
        },
      },
    });

    let stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.siloUsdeBalance).toBe(amount);

    // Claim: outflow returns the balance to zero and retires the cooldown.
    await siloOutflow(indexer, { to: OWNER, from: OWNER, value: amount, block: 802, logIndex: 0, timestamp: TS + 100 });
    stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.siloUsdeBalance).toBe(0n);
    t.expect(stats.pendingCooldownAmount).toBe(0n);
  });

  it("Two equal-amount claims in ONE batch each retire their own cooldown (getWhere sees same-batch writes)", async (t) => {
    const indexer = createTestIndexer();
    const amount = usde(500n);
    await withdraw(indexer, { owner: OWNER, receiver: SILO, assets: amount, block: 900, logIndex: 0 });
    await withdraw(indexer, { owner: OWNER2, receiver: SILO, assets: amount, block: 901, logIndex: 0 });

    // Both claims mined in the same block, processed in a single batch. The
    // second resolves via the sole-candidate path, which only works if the
    // first claim's CLAIMED write is visible to getWhere within the batch.
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "USDe",
              event: "Transfer",
              logIndex: 5,
              block: { number: 902, timestamp: TS + 200 },
              transaction: { hash: TX, from: OWNER },
              params: { from: SILO, to: OWNER, value: amount },
            },
            {
              contract: "USDe",
              event: "Transfer",
              logIndex: 9,
              block: { number: 902, timestamp: TS + 200 },
              transaction: { hash: TX, from: RELAYER },
              params: { from: SILO, to: RECEIVER, value: amount },
            },
          ],
        },
      },
    });

    t.expect((await indexer.SusdeCooldown.getOrThrow(OWNER)).status).toBe("CLAIMED");
    t.expect((await indexer.SusdeCooldown.getOrThrow(OWNER2)).status).toBe("CLAIMED");
    const stats = await indexer.StakingStats.getOrThrow("global");
    t.expect(stats.pendingCooldownAmount).toBe(0n);
    t.expect(await indexer.UnmatchedSiloOutflow.getAll()).toHaveLength(0);
  });
});

describe("sUSDe staking — live block", () => {
  // Real StakedUSDeV2 (sUSDe) Deposit pulled from mainnet via HyperSync.
  // Discovered with a HyperSync logs query for the ERC-4626 Deposit topic
  // (0xdcbc1c05...) against 0x9D39A5DE...3497.
  it("indexes a real sUSDe Deposit at block 25440430", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: { 1: { startBlock: 25_440_430, endBlock: 25_440_430 } },
    });

    const action = await indexer.StakeAction.getOrThrow("1_25440430_226");
    t.expect(action.actionType).toBe("DEPOSIT");
    t.expect(action.account).toBe("0x8F10B468b06c6FD214B65F87778827F7D113f996");
    t.expect(action.assets).toBe(18_770_005_995_333_685_425_207n);
    t.expect(action.shares).toBe(15_167_017_976_940_546_333_641n);
    t.expect(action.txHash).toBe(
      "0x5bbdefa4971f1f86ddadec1bb845330156e7154fc3e27498706ad19705c8f0a8",
    );
  });
});
