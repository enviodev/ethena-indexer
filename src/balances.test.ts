import { describe, it } from "vitest";
import { createTestIndexer, TestHelpers } from "envio";

const { Addresses } = TestHelpers;

type Hex = `0x${string}`;

// Distinct, valid checksummed test actors.
const A = Addresses.mockAddresses[0]! as Hex;
const B = Addresses.mockAddresses[1]! as Hex;
const C = Addresses.mockAddresses[2]! as Hex;
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;

// Registry seed (guaranteed present): Ethena sUSDe staking vault on mainnet.
// Literal, not imported, so a bad registry edit surfaces here.
const SEED = "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497" as Hex;
const SEED_SLUG = "ethena-susde-staking-ethereum";

const TX = ("0x" + "ab".repeat(32)) as Hex;

// Fixed base timestamp and its hour bucket (floor to 3600s).
const TS = 1_700_000_000;
const HOUR = Math.floor(TS / 3600) * 3600;

const E18 = 10n ** 18n;
const usde = (whole: bigint) => whole * E18;

type Indexer = ReturnType<typeof createTestIndexer>;

// A USDe/sUSDe OFT Transfer on an L2 chain (the contracts are only configured
// on 42161/8453/56/5000/999).
function oftTransfer(
  indexer: Indexer,
  opts: {
    chain: 42161 | 8453 | 56 | 5000 | 999;
    contract: "UsdeOFT" | "SusdeOFT";
    from: Hex;
    to: Hex;
    value: bigint;
    txFrom?: Hex;
    block: number;
    logIndex: number;
    timestamp?: number;
  },
) {
  return indexer.process({
    chains: {
      [opts.chain]: {
        simulate: [
          {
            contract: opts.contract,
            event: "Transfer",
            logIndex: opts.logIndex,
            block: { number: opts.block, timestamp: opts.timestamp ?? TS },
            transaction: { hash: TX, from: opts.txFrom ?? opts.from },
            params: { from: opts.from, to: opts.to, value: opts.value },
          },
        ],
      },
    },
  });
}

// A mainnet USDe Transfer (routed through usde.ts → trackTransfer).
function usdeTransfer(
  indexer: Indexer,
  opts: {
    from: Hex;
    to: Hex;
    value: bigint;
    txFrom?: Hex;
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
            transaction: { hash: TX, from: opts.txFrom ?? opts.from },
            params: { from: opts.from, to: opts.to, value: opts.value },
          },
        ],
      },
    },
  });
}

describe("balances engine (trackTransfer) — supply & holder balances", () => {
  it("OFT mint (from 0x0) grows ChainSupply and creates the recipient TokenBalance", async (t) => {
    const indexer = createTestIndexer();
    const v = usde(1_000n);
    await oftTransfer(indexer, {
      chain: 42161,
      contract: "UsdeOFT",
      from: ZERO,
      to: A,
      value: v,
      block: 100,
      logIndex: 0,
    });

    const supply = await indexer.ChainSupply.getOrThrow("42161_USDe");
    t.expect(supply.totalSupply).toBe(v);
    t.expect(supply.chainId).toBe(42161);
    t.expect(supply.token).toBe("USDe");

    const bal = await indexer.TokenBalance.getOrThrow(`42161_USDe_${A}`);
    t.expect(bal.balance).toBe(v);
    t.expect(bal.holder).toBe(A);
    t.expect(bal.opportunitySlug).toBeUndefined();

    // Mint has no non-zero `from` side, so only the recipient row exists.
    t.expect(await indexer.TokenBalance.getAll()).toHaveLength(1);
  });

  it("user → user transfer moves balance between holders, supply unchanged", async (t) => {
    const indexer = createTestIndexer();
    const minted = usde(1_000n);
    const moved = usde(300n);
    await oftTransfer(indexer, { chain: 42161, contract: "UsdeOFT", from: ZERO, to: A, value: minted, block: 100, logIndex: 0 });
    await oftTransfer(indexer, { chain: 42161, contract: "UsdeOFT", from: A, to: B, value: moved, block: 101, logIndex: 0 });

    t.expect((await indexer.TokenBalance.getOrThrow(`42161_USDe_${A}`)).balance).toBe(minted - moved);
    t.expect((await indexer.TokenBalance.getOrThrow(`42161_USDe_${B}`)).balance).toBe(moved);
    // A plain transfer touches no supply.
    t.expect((await indexer.ChainSupply.getOrThrow("42161_USDe")).totalSupply).toBe(minted);
  });

  it("burn (to 0x0) decreases ChainSupply and debits the sender only", async (t) => {
    const indexer = createTestIndexer();
    const minted = usde(1_000n);
    const burned = usde(400n);
    await oftTransfer(indexer, { chain: 42161, contract: "UsdeOFT", from: ZERO, to: A, value: minted, block: 100, logIndex: 0 });
    await oftTransfer(indexer, { chain: 42161, contract: "UsdeOFT", from: A, to: ZERO, value: burned, block: 101, logIndex: 0 });

    t.expect((await indexer.ChainSupply.getOrThrow("42161_USDe")).totalSupply).toBe(minted - burned);
    t.expect((await indexer.TokenBalance.getOrThrow(`42161_USDe_${A}`)).balance).toBe(minted - burned);
    // The zero address is never a holder.
    t.expect(await indexer.TokenBalance.get(`42161_USDe_${ZERO}`)).toBeUndefined();
  });

  it("self-transfer (from == to) nets to zero (sequential from-then-to)", async (t) => {
    const indexer = createTestIndexer();
    const minted = usde(1_000n);
    await oftTransfer(indexer, { chain: 42161, contract: "UsdeOFT", from: ZERO, to: A, value: minted, block: 100, logIndex: 0 });
    await oftTransfer(indexer, { chain: 42161, contract: "UsdeOFT", from: A, to: A, value: usde(250n), block: 101, logIndex: 0 });

    // Debit then credit of the same address must cancel exactly.
    t.expect((await indexer.TokenBalance.getOrThrow(`42161_USDe_${A}`)).balance).toBe(minted);
  });

  it("0-value transfer writes nothing (no balance / supply / large-transfer rows)", async (t) => {
    const indexer = createTestIndexer();
    await oftTransfer(indexer, { chain: 42161, contract: "UsdeOFT", from: A, to: B, value: 0n, block: 100, logIndex: 0 });

    t.expect(await indexer.TokenBalance.getAll()).toHaveLength(0);
    t.expect(await indexer.ChainSupply.getAll()).toHaveLength(0);
    t.expect(await indexer.LargeTransfer.getAll()).toHaveLength(0);
  });

  it("sUSDe OFT mint keys ChainSupply/TokenBalance on the sUSDe token", async (t) => {
    const indexer = createTestIndexer();
    const v = usde(500n);
    await oftTransfer(indexer, { chain: 8453, contract: "SusdeOFT", from: ZERO, to: A, value: v, block: 100, logIndex: 0 });

    const supply = await indexer.ChainSupply.getOrThrow("8453_sUSDe");
    t.expect(supply.totalSupply).toBe(v);
    t.expect(supply.token).toBe("sUSDe");
    t.expect((await indexer.TokenBalance.getOrThrow(`8453_sUSDe_${A}`)).balance).toBe(v);
  });
});

describe("balances engine — whale watch (LargeTransfer from OFT feeds)", () => {
  it("OFT transfer >= 1M records a LargeTransfer with the L2 chainId; below-threshold does not", async (t) => {
    const indexer = createTestIndexer();
    const big = usde(2_000_000n);
    await oftTransfer(indexer, {
      chain: 42161,
      contract: "UsdeOFT",
      from: A,
      to: B,
      value: big,
      txFrom: C,
      block: 300,
      logIndex: 7,
    });
    // Below threshold — different block so it isn't skipped by the test indexer.
    await oftTransfer(indexer, { chain: 42161, contract: "UsdeOFT", from: A, to: B, value: usde(5n), block: 301, logIndex: 0 });

    const lt = await indexer.LargeTransfer.getOrThrow("42161_300_7");
    t.expect(lt.chainId).toBe(42161);
    t.expect(lt.token).toBe("USDe");
    t.expect(lt.amount).toBe(big);
    t.expect(lt.from).toBe(A);
    t.expect(lt.to).toBe(B);
    t.expect(lt.txFrom).toBe(C);

    t.expect(await indexer.LargeTransfer.getAll()).toHaveLength(1);
  });
});

describe("balances engine — registry classification (Opportunity TVL)", () => {
  it("USDe transfer INTO the seed opportunity credits it; transfer OUT debits it", async (t) => {
    const indexer = createTestIndexer();
    const inAmt = usde(10_000n);
    const outAmt = usde(4_000n);

    // Inbound: user → classified vault.
    await usdeTransfer(indexer, { from: A, to: SEED, value: inAmt, block: 100, logIndex: 0, timestamp: TS });

    let opp = await indexer.Opportunity.getOrThrow(SEED_SLUG);
    t.expect(opp.usdeBalance).toBe(inAmt);
    t.expect(opp.susdeBalance).toBe(0n);
    t.expect(opp.protocol).toBe("ethena");
    t.expect(opp.category).toBe("vault");
    t.expect(opp.chainId).toBe(1);
    t.expect(opp.isYieldVenue).toBe(true); // vault is a yield category
    t.expect(opp.lastUpdatedTimestamp).toBe(BigInt(TS));

    // The classified holder's TokenBalance carries the opportunity slug.
    const held = await indexer.TokenBalance.getOrThrow(`1_USDe_${SEED}`);
    t.expect(held.balance).toBe(inAmt);
    t.expect(held.opportunitySlug).toBe(SEED_SLUG);

    // End-of-hour snapshot reflects post-update balances.
    let snap = await indexer.OpportunityHourlySnapshot.getOrThrow(`${SEED_SLUG}_${HOUR}`);
    t.expect(snap.opportunitySlug).toBe(SEED_SLUG);
    t.expect(snap.hourStartTimestamp).toBe(BigInt(HOUR));
    t.expect(snap.usdeBalance).toBe(inAmt);

    // Outbound: vault → user, same hour. Opportunity + snapshot decrement.
    await usdeTransfer(indexer, { from: SEED, to: B, value: outAmt, block: 101, logIndex: 0, timestamp: TS + 60 });

    opp = await indexer.Opportunity.getOrThrow(SEED_SLUG);
    t.expect(opp.usdeBalance).toBe(inAmt - outAmt);

    t.expect((await indexer.TokenBalance.getOrThrow(`1_USDe_${SEED}`)).balance).toBe(inAmt - outAmt);

    // Same hour bucket → last write wins (end-of-hour reading).
    snap = await indexer.OpportunityHourlySnapshot.getOrThrow(`${SEED_SLUG}_${HOUR}`);
    t.expect(snap.usdeBalance).toBe(inAmt - outAmt);
    t.expect(await indexer.OpportunityHourlySnapshot.getAll()).toHaveLength(1);

    // The counterparty B is unclassified — no slug, no Opportunity of its own.
    t.expect((await indexer.TokenBalance.getOrThrow(`1_USDe_${B}`)).opportunitySlug).toBeUndefined();
    t.expect(await indexer.Opportunity.getAll()).toHaveLength(1);
  });
});

describe("balances engine — mainnet supply invariant", () => {
  // Mainnet supply is intentionally tracked twice (ChainSupply(1_USDe) by the
  // balances engine, ProtocolStats.usdeTotalSupply by the phase-1 handler).
  // This pins the two counters together so a future change to one path that
  // misses the other fails loudly instead of silently diverging.
  it("ChainSupply(1_USDe) stays equal to ProtocolStats.usdeTotalSupply through mint and burn", async (t) => {
    const indexer = createTestIndexer();
    await usdeTransfer(indexer, { from: ZERO, to: A, value: usde(900n), block: 100, logIndex: 0 });
    await usdeTransfer(indexer, { from: A, to: ZERO, value: usde(250n), block: 101, logIndex: 0 });

    const chainSupply = (await indexer.ChainSupply.getOrThrow("1_USDe")).totalSupply;
    const protocolSupply = (await indexer.ProtocolStats.getOrThrow("global")).usdeTotalSupply;
    t.expect(chainSupply).toBe(usde(650n));
    t.expect(protocolSupply).toBe(chainSupply);
  });
});

describe("balances engine — live block", () => {
  // Real USDe OFT (0x5d3a...ef34) mint on Base, discovered via a HyperSync logs
  // query for the ERC-20 Transfer topic against that address. Block 15899728
  // contains exactly one USDe/sUSDe OFT log: a 1e12-unit mint (from 0x0) to
  // 0x3aa3fd1b762cac519d405297ce630bed30430b00.
  it("indexes a real USDe OFT mint on Base at block 15899728", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: { 8453: { startBlock: 15_899_728, endBlock: 15_899_728 } },
    });

    const supply = await indexer.ChainSupply.getOrThrow("8453_USDe");
    t.expect(supply.totalSupply).toBe(1_000_000_000_000n);
    t.expect(supply.chainId).toBe(8453);
    t.expect(supply.token).toBe("USDe");

    const balances = await indexer.TokenBalance.getAll();
    const recipient = balances.find(
      (b) => b.chainId === 8453 && b.token === "USDe",
    );
    t.expect(recipient).toBeDefined();
    t.expect(recipient!.balance).toBe(1_000_000_000_000n);
    t.expect(recipient!.holder.toLowerCase()).toBe(
      "0x3aa3fd1b762cac519d405297ce630bed30430b00",
    );
    t.expect(recipient!.opportunitySlug).toBeUndefined();
  });
});
