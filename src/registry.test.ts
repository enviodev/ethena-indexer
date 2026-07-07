import { describe, it, expect } from "vitest";
import { getAddress } from "viem";
import {
  REGISTRY,
  lookupOpportunity,
  type OpportunityCategory,
} from "./handlers/registry";

// Registry content is STATIC data — these tests never touch the network.

const VALID_CHAINS = new Set([1, 42161, 8453, 56, 5000, 999]);
const VALID_CATEGORIES = new Set<OpportunityCategory>([
  "money-market",
  "dex-pool",
  "yield-tokenization",
  "vault",
  "cex",
  "bridge",
  "perps",
  "other",
]);

const SEED_SLUG = "ethena-susde-staking-ethereum";
const SEED_ADDRESS = "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497";

describe("opportunity registry", () => {
  it("is non-trivially populated", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(25);
  });

  it("every entry has non-empty slug/name/protocol", () => {
    for (const e of REGISTRY) {
      expect(e.slug, JSON.stringify(e)).toBeTruthy();
      expect(e.slug.trim().length).toBeGreaterThan(0);
      expect(e.name.trim().length, e.slug).toBeGreaterThan(0);
      expect(e.protocol.trim().length, e.slug).toBeGreaterThan(0);
      // protocol key is a lowercase token
      expect(e.protocol, e.slug).toBe(e.protocol.toLowerCase());
    }
  });

  it("slugs are unique", () => {
    const slugs = REGISTRY.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("(chainId, address) pairs are unique", () => {
    const keys = REGISTRY.map((e) => `${e.chainId}:${e.address.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every address is a valid checksummed address", () => {
    for (const e of REGISTRY) {
      // getAddress throws on an invalid address and returns the checksummed
      // form; storing the checksummed form means this is an identity.
      expect(getAddress(e.address), e.slug).toBe(e.address);
    }
  });

  it("every chainId is in scope", () => {
    for (const e of REGISTRY) {
      expect(VALID_CHAINS.has(e.chainId), `${e.slug} chainId=${e.chainId}`).toBe(
        true,
      );
    }
  });

  it("every category is valid", () => {
    for (const e of REGISTRY) {
      expect(VALID_CATEGORIES.has(e.category), `${e.slug} ${e.category}`).toBe(
        true,
      );
    }
  });

  it("contains the seed Ethena sUSDe staking entry", () => {
    const seed = REGISTRY.find((e) => e.slug === SEED_SLUG);
    expect(seed).toBeDefined();
    expect(seed!.chainId).toBe(1);
    expect(getAddress(seed!.address)).toBe(SEED_ADDRESS);
  });

  describe("lookupOpportunity", () => {
    it("resolves the seed entry", () => {
      const e = lookupOpportunity(1, SEED_ADDRESS);
      expect(e?.slug).toBe(SEED_SLUG);
    });

    it("is case-insensitive on the address", () => {
      const lower = lookupOpportunity(1, SEED_ADDRESS.toLowerCase());
      const upper = lookupOpportunity(1, SEED_ADDRESS.toUpperCase());
      // note: toUpperCase() also uppercases the 0x prefix; lookup lowercases
      // internally so both must resolve to the same entry.
      expect(lower?.slug).toBe(SEED_SLUG);
      expect(upper?.slug).toBe(SEED_SLUG);
    });

    it("resolves every registered entry by its own address", () => {
      for (const e of REGISTRY) {
        const hit = lookupOpportunity(e.chainId, e.address);
        expect(hit?.slug, e.slug).toBe(e.slug);
        // and case-insensitively
        expect(
          lookupOpportunity(e.chainId, e.address.toLowerCase())?.slug,
          e.slug,
        ).toBe(e.slug);
      }
    });

    it("returns undefined for an unknown address", () => {
      expect(
        lookupOpportunity(1, "0x0000000000000000000000000000000000000000"),
      ).toBeUndefined();
    });

    it("returns undefined when the address exists on a different chain", () => {
      // The seed address is only registered on chain 1.
      expect(lookupOpportunity(56, SEED_ADDRESS)).toBeUndefined();
    });
  });
});
