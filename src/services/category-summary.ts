import type { CategoryRule, CategorySuggestion, NormalizedTransaction, UncategorizedSummaryGroup } from "../types.js";
import { roundMoney } from "./masking.js";
import { suggestCategoryForTransaction } from "./category-rules.js";
import { normalizeDescription } from "./transaction-matching.js";

export function summarizeUncategorized(
  transactions: NormalizedTransaction[],
  rules: CategoryRule[] = []
): UncategorizedSummaryGroup[] {
  const uncategorized = transactions.filter((transaction) => !transaction.category?.trim());
  const groups = new Map<string, NormalizedTransaction[]>();

  for (const transaction of uncategorized) {
    const merchant = merchantKey(transaction.description);
    const list = groups.get(merchant) ?? [];
    list.push(transaction);
    groups.set(merchant, list);
  }

  return [...groups.entries()]
    .map(([merchant, group]) => {
      const suggestion = bestCategorySuggestion(group, rules);
      return {
        merchant,
        suggestedCategory: suggestion.category,
        suggestionConfidence: suggestion.confidence,
        suggestionReason: suggestion.reason,
        matchingRuleId: suggestion.matchingRuleId,
        count: group.length,
        total: roundMoney(group.reduce((sum, transaction) => sum + transaction.amount, 0)),
        examples: group
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 3)
      };
    })
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

function merchantKey(description: string): string {
  const normalized = normalizeDescription(description);
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.slice(0, 4).join(" ") || "unknown merchant";
}

function bestCategorySuggestion(group: NormalizedTransaction[], rules: CategoryRule[]): CategorySuggestion {
  return group
    .map((transaction) => suggestCategoryForTransaction(transaction, rules))
    .sort((a, b) => b.confidence - a.confidence)[0] ?? {
      category: "Needs Review",
      confidence: 0.2,
      reason: "No transactions were available to suggest a category."
    };
}
