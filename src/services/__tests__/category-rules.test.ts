import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { NormalizedTransaction } from "../../types.js";
import {
  addCategoryRule,
  loadCategoryRules,
  normalizeCategoryRuleText,
  removeCategoryRule,
  suggestCategoryForTransaction
} from "../category-rules.js";

let tempDirs: string[] = [];

async function tempFile(fileName: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "finance-mcp-category-rules-"));
  tempDirs.push(dir);
  return path.join(dir, fileName);
}

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
    description: "Coffee Shop",
    category: null,
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("category rules", () => {
  it("normalizes rule and transaction text for matching", () => {
    expect(normalizeCategoryRuleText("POS Debit Card 123456 KING   SOOPERS!!")).toBe("king soopers");
  });

  it("adds, updates, loads, and removes local rules", async () => {
    const filePath = await tempFile("category-rules.json");

    const added = await addCategoryRule(filePath, {
      match: "King Soopers",
      category: "Groceries",
      createdAt: "2026-05-14T12:00:00.000Z"
    });
    const updated = await addCategoryRule(filePath, {
      match: "king soopers",
      category: "Household Groceries",
      createdAt: "2026-05-15T12:00:00.000Z"
    });
    const loaded = await loadCategoryRules(filePath);
    const removed = await removeCategoryRule(filePath, added.rule.id);

    expect(added.created).toBe(true);
    expect(updated.created).toBe(false);
    expect(updated.rule.id).toBe(added.rule.id);
    expect(updated.rule.created_at).toBe("2026-05-14T12:00:00.000Z");
    expect(loaded.rules).toHaveLength(1);
    expect(loaded.rules[0]).toMatchObject({
      id: added.rule.id,
      match: "king soopers",
      category: "Household Groceries"
    });
    expect(removed.removed).toBe(true);
    expect(removed.rules).toHaveLength(0);
  });

  it("scores local rule matches higher than built-in suggestions", async () => {
    const filePath = await tempFile("category-rules.json");
    const added = await addCategoryRule(filePath, {
      match: "king soopers",
      category: "Groceries",
      createdAt: "2026-05-14T12:00:00.000Z"
    });

    const localRuleSuggestion = suggestCategoryForTransaction(
      tx({
        description: "POS Purchase 123456",
        metadata: {
          destination_name: "King Soopers Store 42"
        }
      }),
      added.rules
    );
    const builtInSuggestion = suggestCategoryForTransaction(tx({ description: "Coffee Shop" }), []);
    const unknownSuggestion = suggestCategoryForTransaction(tx({ description: "Mystery Vendor" }), []);

    expect(localRuleSuggestion).toMatchObject({
      category: "Groceries",
      confidence: 0.95,
      matchingRuleId: added.rule.id
    });
    expect(builtInSuggestion).toMatchObject({
      category: "Dining",
      confidence: 0.7
    });
    expect(unknownSuggestion).toMatchObject({
      category: "Needs Review",
      confidence: 0.2
    });
  });
});
