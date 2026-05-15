import { describe, expect, it } from "vitest";
import type { NormalizedTransaction } from "../../types.js";
import {
  findMissingTransactions,
  scoreTransactionMatch
} from "../transaction-matching.js";

function tx(overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  return {
    source: "simplefin",
    id: "sf-1",
    externalIds: [],
    sourceAccountId: "sf-checking",
    sourceAccountName: "Fixture Checking",
    mappedFireflyAccountId: "ff-checking",
    accountDisplayName: "Checking",
    date: "2026-05-10",
    amount: -42.5,
    currency: "USD",
    description: "Coffee Shop",
    ...overrides
  };
}

describe("scoreTransactionMatch", () => {
  it("scores exact matches as high confidence", () => {
    const score = scoreTransactionMatch(tx(), tx({ source: "firefly", id: "ff-1" }));

    expect(score.score).toBe(1);
    expect(score.amountScore).toBe(1);
    expect(score.dateScore).toBe(1);
    expect(score.descriptionScore).toBe(1);
  });

  it("scores same amount and date with different descriptions as plausible but not exact", () => {
    const score = scoreTransactionMatch(tx(), tx({ source: "firefly", id: "ff-1", description: "Hardware Store" }));

    expect(score.amountScore).toBe(1);
    expect(score.dateScore).toBe(1);
    expect(score.descriptionScore).toBeLessThan(0.4);
    expect(score.score).toBeGreaterThan(0.75);
    expect(score.score).toBeLessThan(1);
  });

  it.each([
    ["one day before", "2026-05-09", 1, 0.85],
    ["one day after", "2026-05-11", 1, 0.85],
    ["two days before", "2026-05-08", 2, 0.65],
    ["two days after", "2026-05-12", 2, 0.65]
  ])("scores %s date proximity as a match", (_label, candidateDate, expectedDistance, expectedDateScore) => {
    const score = scoreTransactionMatch(tx(), tx({ source: "firefly", id: "ff-1", date: candidateDate }));

    expect(score.dateDistanceDays).toBe(expectedDistance);
    expect(score.dateScore).toBe(expectedDateScore);
    expect(score.score).toBeGreaterThan(expectedDistance === 1 ? 0.9 : 0.85);
  });

  it("rejects different mapped accounts", () => {
    const score = scoreTransactionMatch(tx(), tx({
      source: "firefly",
      id: "ff-1",
      mappedFireflyAccountId: "ff-savings"
    }));

    expect(score.score).toBe(0);
    expect(score.reasons).toContain("different mapped account");
  });

  it("uses shared external IDs as immediate high confidence", () => {
    const score = scoreTransactionMatch(
      tx({ externalIds: ["bank-id-123"] }),
      tx({
        source: "firefly",
        id: "ff-1",
        externalIds: ["bank-id-123"],
        amount: -99,
        date: "2026-05-20",
        description: "Different merchant"
      })
    );

    expect(score.externalIdScore).toBe(1);
    expect(score.score).toBeGreaterThanOrEqual(0.9);
    expect(score.reasons).toContain("shared external transaction id");
  });
});

describe("findMissingTransactions", () => {
  it("returns clearly missing source transactions", () => {
    const present = tx({ id: "sf-present", description: "Grocery Market", amount: -67.89 });
    const missing = tx({ id: "sf-missing", description: "Unmatched Bank Fee", amount: -12.34, date: "2026-05-09" });
    const ledger = [
      tx({
        source: "firefly",
        id: "ff-present",
        description: "Grocery Market",
        amount: -67.89
      })
    ];

    const findings = findMissingTransactions([present, missing], ledger);

    expect(findings).toHaveLength(1);
    expect(findings[0].transaction.id).toBe("sf-missing");
    expect(findings[0].missingConfidence).toBe(1);
  });
});
