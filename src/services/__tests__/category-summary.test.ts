import { describe, expect, it } from "vitest";
import type { CategoryRule, NormalizedTransaction } from "../../types.js";
import { summarizeUncategorized } from "../category-summary.js";

function tx(overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  return {
    source: "firefly",
    id: "ff-1",
    externalIds: [],
    sourceAccountId: "ff-checking",
    sourceAccountName: "Checking",
    mappedFireflyAccountId: "ff-checking",
    accountDisplayName: "Checking",
    date: "2026-05-10",
    amount: -42.5,
    currency: "USD",
    description: "King Soopers #6201",
    category: null,
    ...overrides
  };
}

describe("summarizeUncategorized", () => {
  it("uses local category rules in uncategorized summaries", () => {
    const rules: CategoryRule[] = [
      {
        id: "category_rule:test",
        match: "king soopers",
        category: "Groceries",
        created_at: "2026-05-14T12:00:00.000Z"
      }
    ];

    const groups = summarizeUncategorized([
      tx(),
      tx({ id: "ff-2", amount: -10, date: "2026-05-11" }),
      tx({ id: "ff-3", description: "Already Categorized", category: "Dining" })
    ], rules);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      merchant: "king soopers",
      suggestedCategory: "Groceries",
      suggestionConfidence: 0.95,
      suggestionReason: "Matched local category rule \"king soopers\".",
      matchingRuleId: "category_rule:test",
      count: 2,
      total: -52.5
    });
  });
});
