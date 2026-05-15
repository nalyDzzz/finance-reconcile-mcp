import { describe, expect, it } from "vitest";
import type { DuplicateGroup, MissingTransactionFinding, NormalizedTransaction } from "../../types.js";
import {
  fingerprintDuplicateGroup,
  fingerprintMissingTransaction
} from "../fingerprints.js";

function tx(overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  return {
    source: "simplefin",
    id: "secret-transaction-id-1",
    externalIds: ["secret-external-id-1"],
    sourceAccountId: "full-source-account-123456789",
    sourceAccountName: "Checking (...6789)",
    mappedFireflyAccountId: "ff-checking",
    accountDisplayName: "Checking",
    date: "2026-05-10",
    amount: -42.5,
    currency: "USD",
    description: "POS Debit Card 123456 Coffee Shop",
    ...overrides
  };
}

function missingFinding(transaction: NormalizedTransaction): MissingTransactionFinding {
  return {
    transaction,
    missingConfidence: 1,
    bestMatchScore: 0,
    possibleMatches: []
  };
}

describe("finding fingerprints", () => {
  it("keeps missing transaction fingerprints stable across raw IDs and account-number-like text", () => {
    const first = fingerprintMissingTransaction(missingFinding(tx()));
    const second = fingerprintMissingTransaction(missingFinding(tx({
      id: "different-secret-id",
      externalIds: ["different-external-id"],
      sourceAccountId: "another-full-account-999999999",
      description: "pos debit card 999999 coffee shop"
    })));

    expect(second).toBe(first);
    expect(first).toMatch(/^missing_transaction:[a-f0-9]{32}$/);
  });

  it("changes missing transaction fingerprints when stable financial fields change", () => {
    const first = fingerprintMissingTransaction(missingFinding(tx()));
    const second = fingerprintMissingTransaction(missingFinding(tx({ amount: -43.5 })));

    expect(second).not.toBe(first);
  });

  it("keeps duplicate group fingerprints stable regardless of transaction order", () => {
    const a = tx({
      source: "firefly",
      id: "ff-a",
      externalIds: ["ff-secret-a"],
      description: "Grocery Market",
      amount: -67.89,
      date: "2026-05-12"
    });
    const b = tx({
      source: "firefly",
      id: "ff-b",
      externalIds: ["ff-secret-b"],
      description: "Grocery Market 123456",
      amount: -67.89,
      date: "2026-05-12"
    });
    const groupOne: DuplicateGroup = {
      confidence: 1,
      reasons: [],
      transactions: [a, b]
    };
    const groupTwo: DuplicateGroup = {
      confidence: 0.8,
      reasons: ["different scoring text should not matter"],
      transactions: [b, a]
    };

    expect(fingerprintDuplicateGroup(groupTwo)).toBe(fingerprintDuplicateGroup(groupOne));
  });
});
